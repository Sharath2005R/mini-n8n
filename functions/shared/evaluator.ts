// functions/shared/evaluator.ts

function getNestedValue(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

export interface Condition {
  field: string;
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains' | '==' | '!=' | '>' | '<';
  value: any;
}

export function evaluateCondition(previousOutput: any, condition: Condition): boolean {
  if (!condition || !condition.field || !condition.operator) {
    return false;
  }

  const actualValue = getNestedValue(previousOutput, condition.field);
  const targetValue = condition.value;

  switch (condition.operator) {
    case 'equals':
    case '==':
      return actualValue === targetValue;
    case 'not_equals':
    case '!=':
      return actualValue !== targetValue;
    case 'greater_than':
    case '>':
      return Number(actualValue) > Number(targetValue);
    case 'less_than':
    case '<':
      return Number(actualValue) < Number(targetValue);
    case 'contains':
      if (typeof actualValue === 'string') {
        return actualValue.includes(targetValue);
      }
      if (Array.isArray(actualValue)) {
        return actualValue.includes(targetValue);
      }
      return false;
    default:
      console.warn(`Unsupported operator: ${condition.operator}`);
      return false;
  }
}
