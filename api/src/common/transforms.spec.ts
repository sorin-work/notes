import { plainToInstance } from 'class-transformer';
import { ToBoolean, Trim } from './transforms';

class Example {
  @Trim()
  name: string;

  @ToBoolean()
  flag: boolean | string;
}

describe('transforms', () => {
  it('trims strings and leaves other values alone', () => {
    expect(plainToInstance(Example, { name: '  Work  ' }).name).toBe('Work');
    expect(plainToInstance(Example, { name: 42 }).name).toBe(42);
  });

  it('turns query string booleans into booleans', () => {
    expect(plainToInstance(Example, { flag: 'true' }).flag).toBe(true);
    expect(plainToInstance(Example, { flag: '0' }).flag).toBe(false);
    expect(plainToInstance(Example, { flag: 'maybe' }).flag).toBe('maybe');
  });
});
