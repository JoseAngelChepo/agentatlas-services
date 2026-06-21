/** Mirrors workspace User input node `data` shape. */
export type UserInputNodeData = {
  name?: string;
  question?: string;
  suggestedAnswers?: string[];
};

export type UserInputNodeOutput = {
  kind: 'user_input';
  needsInputId: string;
  question: string;
  answer: string | null;
  skipped: boolean;
  passthrough: Record<string, unknown>;
};
