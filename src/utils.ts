export interface FromCallbackOptions {
  multiArgs?: boolean;
}

export function fromCallback(fn: (cb) => void, opts?: FromCallbackOptions): Promise<any> {
  return new Promise(function (resolve, reject) {
    fn(function (err, ...results) {
      if (err) return reject(err);
      if (opts && opts.multiArgs) {
        resolve(results);
      } else {
        resolve(results[0]);
      }
    });
  })
}

export function asCallback<T>(promise, cb: (err, result?) => void) {
  return promise.then(result => cb(null, result)).catch(cb);
}
