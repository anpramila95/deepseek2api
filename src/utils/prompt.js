export function buildPromptFromMessages(messages) {
  return messages
    .map((message) => `${message.role.toUpperCase()}: ${message.content ?? ""}`)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n");
}
