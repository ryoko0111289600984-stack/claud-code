const PREFIX = "jhhzzy";

export function info(message) {
  process.stderr.write(`${PREFIX}: ${message}\n`);
}

export function warn(message) {
  process.stderr.write(`${PREFIX}: warning: ${message}\n`);
}

export function step(message) {
  process.stderr.write(`${PREFIX}: → ${message}\n`);
}

export function out(message) {
  process.stdout.write(`${message}\n`);
}
