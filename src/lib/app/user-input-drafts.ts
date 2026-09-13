import type { UserInputRequest } from '../types';

export function userInputDraftKey(request: Pick<UserInputRequest, 'sessionId' | 'requestId' | 'turnId'>, questionId: string): string {
  return JSON.stringify([request.sessionId, request.requestId, questionId, request.turnId]);
}

export function answeredRequest(request: UserInputRequest, drafts: Record<string, string>): Record<string, string[]> | null {
  const answers = request.questions.map(question => {
    const value = drafts[userInputDraftKey(request, question.id)]?.trim() ?? '';
    return [question.id, value] as const;
  });
  if (!answers.length || answers.some(([, value]) => !value)) return null;
  return Object.fromEntries(answers.map(([id, value]) => [id, [value]]));
}

export function clearRequestDrafts(request: UserInputRequest, drafts: Record<string, string>): Record<string, string> {
  const keys = new Set(request.questions.map(question => userInputDraftKey(request, question.id)));
  return Object.fromEntries(Object.entries(drafts).filter(([key]) => !keys.has(key)));
}
