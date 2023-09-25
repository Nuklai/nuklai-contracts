import { BaseContract, EventLog, Log, LogDescription } from 'ethers';

export function getDecodedEvents(
  logs: Log[] | EventLog[],
  contract: BaseContract
): LogDescription[] {
  const events: LogDescription[] = [];

  for (const log of logs) {
    const decodedEvent = contract.interface.parseLog({
      topics: log.topics as unknown as string[],
      data: log.data,
    });

    if (!decodedEvent) continue;

    events.push(decodedEvent);
  }

  return events;
}

export function getEvent(eventName: string, logs: Log[] | EventLog[], contract: BaseContract) {
  const events = getDecodedEvents(logs, contract);

  for (const event of events) {
    if (event.name === eventName) return event;
  }
}
