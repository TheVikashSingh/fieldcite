// Messages to the owner: breaker trips (CS-7) and the daily spend summary (CS-9, CS-13).
// The email version (Resend) comes later; until then messages go to the log.

export interface OwnerMessage {
  subject: string;
  text: string;
}

export interface Notifier {
  notify(message: OwnerMessage): Promise<void>;
}

export class LogNotifier implements Notifier {
  constructor(private readonly log: (line: string) => void = (line) => console.log(line)) {}

  async notify(message: OwnerMessage): Promise<void> {
    this.log(`[owner] ${message.subject}\n${message.text}`);
  }
}
