// Bytes from a MOO -> lines. Telnet commands are taken out (MOOs mostly send
// none; ToastStunt can send option negotiation and GA): every option is
// refused, IAC IAC is a literal 255. Lines end at LF; a CR before it, and
// any lone CR, is dropped.
//
//   const t = new Telnet({ line(text), reply(bytes) })
//   t.feed(bytes)     // a chunk from the socket
//   t.partial         // text received after the last newline (a prompt)

const IAC = 255, DONT = 254, DO = 253, WONT = 252, WILL = 251, SB = 250, SE = 240;

export class Telnet {
  constructor({ line, reply }) {
    this.onLine = line;
    this.reply = reply;
    this.buf = [];
    this.state = 0;      // 0 data, IAC, WILL..DONT (waiting for the option), SB, SB+IAC
    this.dec = new TextDecoder();
  }

  get partial() {
    return this.dec.decode(new Uint8Array(this.buf));
  }

  feed(bytes) {
    for (const b of bytes) {
      switch (this.state) {
        case 0:
          if (b === IAC) this.state = IAC;
          else if (b === 10) this.flush();
          else if (b !== 13) this.buf.push(b);
          break;
        case IAC:
          if (b === IAC) { this.buf.push(IAC); this.state = 0; }
          else if (b >= WILL && b <= DONT) this.state = b;
          else if (b === SB) this.state = SB;
          else this.state = 0;  // GA, NOP, …
          break;
        case WILL: case WONT: case DO: case DONT:
          if (this.state === WILL) this.reply([IAC, DONT, b]);
          else if (this.state === DO) this.reply([IAC, WONT, b]);
          this.state = 0;
          break;
        case SB:
          if (b === IAC) this.state = SB + 1;
          break;
        case SB + 1:
          this.state = b === SE ? 0 : SB;
          break;
      }
    }
  }

  flush() {
    const text = this.partial;
    this.buf = [];
    this.onLine(text);
  }
}
