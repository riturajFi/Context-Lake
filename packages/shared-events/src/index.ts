export const topicNames = {
  rawIngest: 'context.raw.ingest',
  auditLog: 'context.audit.log',
} as const;

export type TopicName = (typeof topicNames)[keyof typeof topicNames];
