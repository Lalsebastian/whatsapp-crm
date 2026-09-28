function log(tag, ...args) {
  console.log(`[${tag}]`, ...args);
}

function warn(tag, ...args) {
  console.warn(`[${tag}]`, ...args);
}

function error(tag, ...args) {
  console.error(`[${tag}]`, ...args);
}

module.exports = { log, warn, error };
