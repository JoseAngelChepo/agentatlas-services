export type EndOutputFieldSource = 'field' | 'runInput' | 'static';

export type EndOutputField = {
  id?: string;
  key?: string;
  source?: EndOutputFieldSource;
  valuePath?: string;
  staticValue?: string;
};

export type EndNodeData = {
  label?: string;
  fields?: EndOutputField[];
};

export type EndNodeOutput = {
  kind: 'end';
  output: Record<string, unknown>;
};
