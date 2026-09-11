const CHAT_MODELS = Object.freeze([
  Object.freeze({
    id: "deepseek-v4-flash",
    modelType: null,
    searchEnabled: false,
    thinkingEnabled: false,
    supportsUploads: true,
  }),
  Object.freeze({
    id: "deepseek-v4-flash-search",
    modelType: null,
    searchEnabled: true,
    thinkingEnabled: false,
    supportsUploads: true,
  }),
  Object.freeze({
    id: "deepseek-v4-flash-thinking",
    modelType: null,
    searchEnabled: false,
    thinkingEnabled: true,
    supportsUploads: true,
  }),
  Object.freeze({
    id: "deepseek-v4-flash-thinking-search",
    modelType: null,
    searchEnabled: true,
    thinkingEnabled: true,
    supportsUploads: true,
  }),
]);

const CHAT_MODEL_MAP = Object.freeze(
  Object.fromEntries(CHAT_MODELS.map((model) => [model.id, model])),
);

export function resolveChatModel(modelId) {
  const resolvedModel = CHAT_MODEL_MAP[modelId];

  if (!resolvedModel) {
    throw new Error(`Unsupported chat model: ${modelId}`);
  }

  return resolvedModel;
}
