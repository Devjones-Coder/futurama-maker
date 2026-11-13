import assert from 'node:assert/strict';
import { CommandParseError, parseCommand } from '../src/index';

assert.deepEqual(parseCommand('Urgente -top -pb').alignment.vertical, { direction: 'top', percent: 100 });
assert.deepEqual(parseCommand('Urgente -bottom30 -left5 -pb'), {
  headline: 'Urgente', alignment: { vertical: { direction: 'bottom', percent: 30 }, horizontal: { direction: 'left', percent: 5 } }, grayscale: true, warnings: [],
});
assert.equal(parseCommand('sem flags').headline, 'sem flags');
assert.match(parseCommand('X -top -bottom50').warnings[0], /prevaleceu top/);
assert.throws(() => parseCommand('X -top0'), CommandParseError);
assert.throws(() => parseCommand('X -ia'), CommandParseError);
