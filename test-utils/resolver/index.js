const glob = require('glob');

let mapping = {};

glob.sync(`${__dirname}/../../src/**/__tests__/modules-resolution.json`).forEach((file) => {
  // eslint-disable-next-line import/no-dynamic-require, global-require
  mapping = { ...mapping, ...require(file) };
});

function resolver(path, options) {
  return mapping[path] || options.defaultResolver(path, options);
}

module.exports = resolver;
