import {Driver} from "./defines";
import pad = require("pad");

export const FAT_SECTOR_SIZE = 512;
export const FAT_BUFFERS = 1;

const FAT32_INVALID_CLUSTER = 0xFFFFFFFF;

const SECTOR_JUMP_AND_OEMNAMR = Buffer.from([0xEB, 0x3C, 0x90, 0x4D, 0x53, 0x44, 0x4F, 0x53, 0x35, 0x2E, 0x30]);

export interface SectorsPerClusterItem {
  sectors: number;
  sectorsPerCluster: number;
}

const CLUSTER_SIZE_TABLE16: SectorsPerClusterItem[] = [
  {sectors: 32680, sectorsPerCluster: 2},    // 16MB - 1K
  {sectors: 262144, sectorsPerCluster: 4},   // 128MB - 2K
  {sectors: 524288, sectorsPerCluster: 8},   // 256MB - 4K
  {sectors: 1048576, sectorsPerCluster: 16}, // 512MB - 8K
  {sectors: 2097152, sectorsPerCluster: 32}, // 1GB - 16K
  {sectors: 4194304, sectorsPerCluster: 64}, // 2GB - 32K
  {sectors: 8388608, sectorsPerCluster: 128},// 2GB - 64K [Warning only supported by Windows XP onwards]
];

const CLUSTER_SIZE_TABLE32: SectorsPerClusterItem[] = [
  {sectors: 532480, sectorsPerCluster: 1},     // 260MB - 512b
  {sectors: 16777216, sectorsPerCluster: 8},   // 8GB - 4K
  {sectors: 33554432, sectorsPerCluster: 16},  // 16GB - 8K
  {sectors: 67108864, sectorsPerCluster: 32},  // 32GB - 16K
  {sectors: 0xFFFFFFFF, sectorsPerCluster: 64},// >32GB - 32K
];

export enum FatType {
  FAT16,
  FAT32
}

export class FatBuffer {
  sector: Buffer = Buffer.alloc(FAT_SECTOR_SIZE * FAT_SECTOR_SIZE);
  address: number;
  dirty: number;
  ptr;

  next: FatBuffer | null;
}

export class Formatter {
  sectorsPerCluster: number = 0;
  clusterBeginLba: number = 0;
  rootdirFirstCluster: number = 0;
  rootdirFirstSector: number = 0;
  rootdirSectors: number = 0;
  fatBeginLba: number = 0;
  fsInfoSector: number = 0;
  lbaBegin: number = 0;
  fatSectors: number = 0;
  nextFreeCluster: number = 0;
  rootEntryCount: number = 0;
  reservedSectors: number = 0;
  numOfFats: number = 0;
  fatType: FatType;

  currentsector: FatBuffer = new FatBuffer();

  fatBufferHead: FatBuffer | null;
  fatBuffers: FatBuffer[] = Array.from({length: FAT_BUFFERS}, () => new FatBuffer());

  constructor(protected driver: Driver) {
  }

  static async format(driver: Driver) {
    const formatter = new Formatter(driver);
    return formatter.format();
  }

  buildBootSector(bootSectorLba: number, volSectors: number, name: string, isFat32: boolean) {
    let totalClusters: number;
    const {sector} = this.currentsector;

    // Zero sector initially
    sector.fill(0, FAT_SECTOR_SIZE);

    // OEM Name & Jump Code
    SECTOR_JUMP_AND_OEMNAMR.copy(sector, 0);

    // Bytes per sector
    sector[11] = (FAT_SECTOR_SIZE >> 0) & 0xFF;
    sector[12] = (FAT_SECTOR_SIZE >> 8) & 0xFF;

    // Get sectors per cluster size for the disk
    this.sectorsPerCluster = this.calcClusterSize(volSectors, isFat32);
    if (!this.sectorsPerCluster) {
      throw new Error('Invalid disk size');
    }

    // Sectors per cluster
    sector[13] = this.sectorsPerCluster;

    // Reserved Sectors
    this.reservedSectors = !isFat32 ? 8 : 32;

    sector[14] = (this.reservedSectors >> 0) & 0xFF;
    sector[15] = (this.reservedSectors >> 8) & 0xFF;

    // Number of FATS
    this.numOfFats = 2;
    sector[16] = this.numOfFats;

    // Max entries in root dir (FAT16 only)
    if (!isFat32) {
      this.rootEntryCount = 512;
      sector[17] = (this.rootEntryCount >> 0) & 0xFF;
      sector[18] = (this.rootEntryCount >> 8) & 0xFF;
    } else {

      this.rootEntryCount = 0;
      sector[17] = 0;
      sector[18] = 0;
    }

    // [FAT16] Total sectors (use FAT32 count instead)
    sector[19] = 0x00;
    sector[20] = 0x00;

    // Media type
    sector[21] = 0xF8;

    // FAT16 BS Details
    if (!isFat32) {
      // Count of sectors used by the FAT table (FAT16 only)
      const totalClusters = Math.floor(volSectors / this.sectorsPerCluster) + 1;
      this.fatSectors = Math.floor(totalClusters / (FAT_SECTOR_SIZE / 2)) + 1;
      sector[22] = (this.fatSectors >> 0) & 0xFF;
      sector[23] = (this.fatSectors >> 8) & 0xFF;

      // Sectors per track
      sector[24] = 0;
      sector[25] = 0;

      // Heads
      sector[26] = 0;
      sector[27] = 0;

      // Hidden sectors

      sector[28] = 0x20;
      sector[29] = 0x00;
      sector[30] = 0x00;
      sector[31] = 0x00;

      // Total sectors for this volume
      sector[32] = ((volSectors >> 0) & 0xFF);
      sector[33] = ((volSectors >> 8) & 0xFF);
      sector[34] = ((volSectors >> 16) & 0xFF);
      sector[35] = ((volSectors >> 24) & 0xFF);

      // Drive number
      sector[36] = 0x00;

      // Reserved
      sector[37] = 0x00;

      // Boot signature
      sector[38] = 0x29;

      // Volume ID
      sector[39] = 0x12;
      sector[40] = 0x34;
      sector[41] = 0x56;
      sector[42] = 0x78;

      sector.write(pad(name, 11), 43);

      // File sys type
      sector.write(pad('FAT16', 8), 54);

      // Signature
      sector[510] = 0x55;
      sector[511] = 0xAA;
    } else {
      // FAT32 BS Details
      // Count of sectors used by the FAT table (FAT16 only)
      sector[22] = 0;
      sector[23] = 0;

      // Sectors per track (default)
      sector[24] = 0x3F;
      sector[25] = 0x00;

      // Heads (default)
      sector[26] = 0xFF;
      sector[27] = 0x00;

      // Hidden sectors
      sector[28] = 0x00;
      sector[29] = 0x00;
      sector[30] = 0x00;
      sector[31] = 0x00;

      // Total sectors for this volume
      sector[32] = (volSectors >> 0) & 0xFF;
      sector[33] = (volSectors >> 8) & 0xFF;
      sector[34] = (volSectors >> 16) & 0xFF;
      sector[35] = (volSectors >> 24) & 0xFF;

      totalClusters = Math.floor(volSectors / this.sectorsPerCluster) + 1;
      this.fatSectors = Math.floor(totalClusters / (FAT_SECTOR_SIZE / 4)) + 1;

      // BPB_FATSz32
      sector[36] = ((this.fatSectors >> 0) & 0xFF);
      sector[37] = ((this.fatSectors >> 8) & 0xFF);
      sector[38] = ((this.fatSectors >> 16) & 0xFF);
      sector[39] = ((this.fatSectors >> 24) & 0xFF);

      // BPB_ExtFlags
      sector[40] = 0;
      sector[41] = 0;

      // BPB_FSVer
      sector[42] = 0;
      sector[43] = 0;

      // BPB_RootClus
      sector[44] = ((this.rootdirFirstCluster >> 0) & 0xFF);
      sector[45] = ((this.rootdirFirstCluster >> 8) & 0xFF);
      sector[46] = ((this.rootdirFirstCluster >> 16) & 0xFF);
      sector[47] = ((this.rootdirFirstCluster >> 24) & 0xFF);

      // BPB_FSInfo
      sector[48] = ((this.fsInfoSector >> 0) & 0xFF);
      sector[49] = ((this.fsInfoSector >> 8) & 0xFF);

      // BPB_BkBootSec
      sector[50] = 6;
      sector[51] = 0;

      // Drive number
      sector[64] = 0x00;

      // Boot signature
      sector[66] = 0x29;

      // Volume ID
      sector[67] = 0x12;
      sector[68] = 0x34;
      sector[69] = 0x56;
      sector[70] = 0x78;

      // Volume name
      sector.write(pad(name, 11), 71);

      // File sys type
      sector.write(pad('FAT32', 8), 82);

      // Signature
      sector[510] = 0x55;
      sector[511] = 0xAA;
    }
  }

  async createBootSector(bootSectorLba: number, volSectors: number, name: string, isFat32: boolean) {
    this.buildBootSector(bootSectorLba, volSectors, name, isFat32);
    return this.driver.writeSectors(bootSectorLba, this.currentsector.sector.slice(0, FAT_SECTOR_SIZE));
  }

  buildEraseFat(isFat32: boolean) {
    const {sector} = this.currentsector;

    // Zero sector initially
    sector.fill(0, FAT_SECTOR_SIZE);

    // Initialise default allocate / reserved clusters
    if (!isFat32) {
      sector.writeUInt16LE(0xFFF8, 0);
      sector.writeUInt16LE(0xFFFF, 2);
    } else {
      sector.writeUInt32LE(0xFFFFFF8, 0);
      sector.writeUInt32LE(0xFFFFFFF, 4);
      sector.writeUInt32LE(0xFFFFFFF, 8);
    }
  }

  async eraseFat(isFat32: boolean) {
    this.buildEraseFat(isFat32);

    const {sector} = this.currentsector;

    await this.driver.writeSectors(this.fatBeginLba, sector.slice(0, FAT_SECTOR_SIZE));

    // Zero remaining FAT sectors
    sector.fill(0, FAT_SECTOR_SIZE);
    const empty = sector.slice(0, FAT_SECTOR_SIZE);
    for (let i = 1; i < this.fatSectors * this.numOfFats; i++) {
      await this.driver.writeSectors(this.fatBeginLba + i, empty);
    }
  }

  async eraseSectors(lba: number, count: number) {
    const {sector} = this.currentsector;

    // Zero sector initially
    sector.fill(0, FAT_SECTOR_SIZE);
    const empty = sector.slice(0, FAT_SECTOR_SIZE);

    for (let i = 0; i < count; i++) {
      await this.driver.writeSectors(lba + i, empty);
    }
  }

  buildFsinfoSector(sectorLba: number) {
    const {sector} = this.currentsector;

    // Zero sector initially
    sector.fill(0, FAT_SECTOR_SIZE);

    // FSI_LeadSig
    sector[0] = 0x52;
    sector[1] = 0x52;
    sector[2] = 0x61;
    sector[3] = 0x41;

    // FSI_StrucSig
    sector[484] = 0x72;
    sector[485] = 0x72;
    sector[486] = 0x41;
    sector[487] = 0x61;

    // FSI_Free_Count
    sector[488] = 0xFF;
    sector[489] = 0xFF;
    sector[490] = 0xFF;
    sector[491] = 0xFF;

    // FSI_Nxt_Free
    sector[492] = 0xFF;
    sector[493] = 0xFF;
    sector[494] = 0xFF;
    sector[495] = 0xFF;

    // Signature
    sector[510] = 0x55;
    sector[511] = 0xAA;
  }

  async createFsinfoSector(secotrLba: number) {
    this.buildFsinfoSector(secotrLba);
    await this.driver.writeSectors(secotrLba, this.currentsector.sector.slice(0, FAT_SECTOR_SIZE));
  }

  async format16(name: string = '') {
    this.currentsector.address = FAT32_INVALID_CLUSTER;
    this.currentsector.dirty = 0;
    this.nextFreeCluster = 0;

    this.fatInit();

    // Make sure we have read + write functions
    // TODO check driver is writable

    // Volume is FAT16
    this.fatType = FatType.FAT16;

    // Not valid for FAT16
    this.fsInfoSector = 0;
    this.rootdirFirstCluster = 0;

    // Sector 0: Boot sector
    // NOTE: We don't need an MBR, it is a waste of a good sector!
    this.lbaBegin = 0;

    await this.createBootSector(this.lbaBegin, this.driver.numSectors, name, false);

    // For FAT16 (which this may be), rootdir_first_cluster is actuall rootdir_first_sector
    this.rootdirFirstSector = this.reservedSectors + (this.numOfFats * this.fatSectors);
    this.rootdirSectors = Math.floor(((this.rootEntryCount * 32) + (FAT_SECTOR_SIZE - 1)) / FAT_SECTOR_SIZE);

    // First FAT LBA address
    this.fatBeginLba = this.lbaBegin + this.reservedSectors;

    // The address of the first data cluster on this volume
    this.clusterBeginLba = this.fatBeginLba + (this.numOfFats * this.fatSectors);

    await this.eraseFat(false);

    // Erase Root directory
    await this.eraseSectors(this.lbaBegin + this.rootdirFirstSector, this.rootdirSectors);
  }

  async format32(name: string = '') {
    this.currentsector.address = FAT32_INVALID_CLUSTER;
    this.currentsector.dirty = 0;

    this.nextFreeCluster = 0; // Invalid

    this.fatInit();

    // Volume is FAT32
    this.fatType = FatType.FAT32;

    // Basic defaults for normal FAT32 partitions
    this.fsInfoSector = 1;
    this.rootdirFirstCluster = 2;

    // Sector 0: Boot sector
    // NOTE: We don't need an MBR, it is a waste of a good sector!
    this.lbaBegin = 0;
    await this.createBootSector(this.lbaBegin, this.driver.numSectors, name, true);

    // First FAT LBA address
    this.fatBeginLba = this.lbaBegin + this.reservedSectors;

    // The address of the first data cluster on this volume
    this.clusterBeginLba = this.fatBeginLba + (this.numOfFats * this.fatSectors);

    // Initialise FSInfo sector
    await this.createFsinfoSector(this.fsInfoSector);

    // Initialise FAT sectors
    await this.eraseFat(true);

    // Erase Root directory
    await this.eraseSectors(this.lbaOfCluster(this.rootdirFirstCluster), this.sectorsPerCluster);
  }

  async format(name?: string) {
    // 2GB - 32K limit for safe behaviour for FAT16
    if (this.driver.numSectors <= 4194304) {
      return this.format16(name);
    } else {
      return this.format32(name);
    }
  }

  protected fatInit() {
    this.fatBufferHead = null;

    this.fatBuffers.map(buf => {
      // Initialise buffers to invalid
      buf.address = FAT32_INVALID_CLUSTER;
      buf.dirty = 0;
      buf.sector.fill(0);
      buf.ptr = null;

      // Add to head of queue
      buf.next = this.fatBufferHead;
      this.fatBufferHead = buf;
    });
  }

  protected calcClusterSize(sectors: number, isFat32: boolean) {
    const table = isFat32 ? CLUSTER_SIZE_TABLE32 : CLUSTER_SIZE_TABLE16;
    const found = table.find(item => sectors < item.sectors);
    return found ? found.sectorsPerCluster : 0;
  }

  protected lbaOfCluster(cluster: number) {
    if (this.fatType === FatType.FAT16) {
      return this.clusterBeginLba + (this.rootEntryCount * 32 / FAT_SECTOR_SIZE) + ((cluster - 2) * this.sectorsPerCluster);
    } else {
      return this.clusterBeginLba + ((cluster - 2) * this.sectorsPerCluster);
    }
  }
}

export async function format(driver: Driver) {
  return Formatter.format(driver);
}
