export function emitPublicRuleNodeMaterializer(): string {
  return `let RUNTIME_NODE_HANDLES: WeakMap<object, number> = new WeakMap();
const RUNTIME_SYNTAX_VALUES = new Map<number, SyntaxElement>();

function resetPublicSyntaxMaterialization(): void {
  RUNTIME_NODE_HANDLES = new WeakMap<object, number>();
  RUNTIME_SYNTAX_VALUES.clear();
}

function hostRuleNodeRuntimeHandle(node: AnyRuleNode): number | undefined {
  return RUNTIME_NODE_HANDLES.get(node as object);
}

function materializeRuleNode(runtimeHandle: number): AnyRuleNode {
  const ruleId = parserRuleNodeRuleId(runtimeHandle);
  const node = {
    type: "rule",
    name: RULE_NAMES[ruleId],
    span: ruleNodeSpan(runtimeHandle),
    tokenRange: ruleNodeTokenRange(runtimeHandle),
    children: buildChildren(runtimeHandle),
    fields: buildFields(ruleId, runtimeHandle),
  };
  rememberRuleNodeRuntimeHandle(node as unknown as AnyRuleNode, runtimeHandle);
  rememberSyntaxValue(runtimeHandle, node as unknown as SyntaxElement);
  return node as unknown as AnyRuleNode;
}

function rememberRuleNodeRuntimeHandle(
  node: AnyRuleNode,
  runtimeHandle: number,
): void {
  RUNTIME_NODE_HANDLES.set(node as object, runtimeHandle);
}

function rememberSyntaxValue(handle: number, value: SyntaxElement): void {
  RUNTIME_SYNTAX_VALUES.set(handle, value);
}

function hostSyntaxValue(handle: number): SyntaxElement {
  const value = RUNTIME_SYNTAX_VALUES.get(handle);
  if (value === undefined) {
    throw new Error("Runtime syntax object is missing its host value.");
  }
  return value;
}

function buildChildren(ruleNodeHandle: number): SyntaxElement[] {
  const count = parserRuleNodeChildCount(ruleNodeHandle);
  const status = parserRuleNodeChildListStatus(count);
  if (status === RULE_NODE_CHILD_LIST_EMPTY) return [];
  const children = parserRuleNodeChildren(ruleNodeHandle);
  const values: SyntaxElement[] = [];
  for (let index = 0; index < count; index++) {
    values.push(hostSyntaxValue(runtimeVectorLoad(children, index)));
  }
  return values;
}

function ruleNodeSpan(handle: number): Span {
  return {
    start: parserRuleNodeSpanStart(handle),
    end: parserRuleNodeSpanEnd(handle),
  };
}

function ruleNodeTokenRange(handle: number): TokenRange {
  return {
    start: parserRuleNodeTokenStart(handle),
    end: parserRuleNodeTokenEnd(handle),
  };
}`;
}
