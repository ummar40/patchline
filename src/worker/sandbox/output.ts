const ANSI_ESCAPE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;
// PostgreSQL text columns reject NUL, and other control characters only garble the UI.
const CONTROL_CHARACTERS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

export function sanitizeOutput(text: string): string {
  return text
    .replace(ANSI_ESCAPE, "")
    .replace(/\r\n/g, "\n")
    .replace(/[^\n]*\r(?!\n)/g, "")
    .replace(CONTROL_CHARACTERS, "");
}

// Keeps the beginning and the end of a stream and drops the middle, so a runaway process
// cannot exhaust worker memory while the most useful parts of its output survive.
export class BoundedBuffer {
  private readonly head: Buffer[] = [];
  private headBytes = 0;
  private tail: Buffer[] = [];
  private tailBytes = 0;
  private droppedBytes = 0;
  private readonly headLimit: number;
  private readonly tailLimit: number;

  constructor(limitBytes: number) {
    this.headLimit = Math.floor(limitBytes / 4);
    this.tailLimit = limitBytes - this.headLimit;
  }

  get truncated(): boolean {
    return this.droppedBytes > 0;
  }

  append(chunk: Buffer): void {
    let rest = chunk;
    if (this.headBytes < this.headLimit) {
      const take = Math.min(this.headLimit - this.headBytes, rest.length);
      this.head.push(rest.subarray(0, take));
      this.headBytes += take;
      rest = rest.subarray(take);
    }
    if (rest.length === 0) {
      return;
    }
    this.tail.push(rest);
    this.tailBytes += rest.length;
    while (this.tailBytes > this.tailLimit) {
      const first = this.tail[0];
      if (!first) {
        break;
      }
      const excess = this.tailBytes - this.tailLimit;
      if (first.length <= excess) {
        this.tail.shift();
        this.tailBytes -= first.length;
        this.droppedBytes += first.length;
      } else {
        this.tail[0] = first.subarray(excess);
        this.tailBytes -= excess;
        this.droppedBytes += excess;
      }
    }
  }

  // Raw mode returns the bytes as decoded, for callers that need exact file contents.
  toString(raw = false): string {
    const head = Buffer.concat(this.head).toString("utf8");
    const tail = Buffer.concat(this.tail).toString("utf8");
    const text = this.truncated
      ? `${head}\n[... ${this.droppedBytes} bytes omitted ...]\n${tail}`
      : head + tail;
    return raw ? text : sanitizeOutput(text);
  }
}
