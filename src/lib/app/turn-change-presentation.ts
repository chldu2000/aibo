import {nativeDiffText} from './native-text.ts';
import { translateMessage } from '../../../packages/i18n/index.js';
import type { Locale, LocalizedText } from '../../../packages/i18n/index.js';
import type { TurnFileDiff, RestoreOperation, TimelineItem, TurnChangeSet, CheckpointFile } from '../types';
import { readNativeMessage } from './error-utils.ts';
import { parseSubagent } from './subagents.ts';

export function nativeListMessages(raw: readonly string[], metadata: unknown): LocalizedText[] {
  const values = Array.isArray(metadata) && metadata.length === raw.length ? metadata : [];
  return raw.map((text, index) => readNativeMessage(values[index]) ?? text);
}

export function turnFileDiffPresentation(diff: TurnFileDiff | null, locale: Locale): Omit<TurnFileDiff, 'localizedReason' | 'localizedSuffix'> | null {
  if (!diff) return null;
  const { localizedReason, localizedSuffix, ...value } = diff;
  return { ...value, ...nativeDiffText(diff, locale), reason: diff.reason === null ? null : translateMessage(locale, readNativeMessage(localizedReason) ?? diff.reason) };
}

export function restoreOperationsPresentation(operations: RestoreOperation[], locale: Locale): Omit<RestoreOperation, 'localizedConflicts' | 'localizedUnsupported'>[] {
  return operations.map(({ localizedConflicts, localizedUnsupported, ...value }) => ({ ...value,
    conflicts: nativeListMessages(value.conflicts, localizedConflicts).map(text => translateMessage(locale, text)),
    unsupported: nativeListMessages(value.unsupported, localizedUnsupported).map(text => translateMessage(locale, text)),
  }));
}

export function timelinePresentation(items: TimelineItem[], locale: Locale): Omit<TimelineItem, 'localizedContent' | 'localizedActivity'>[] {
  return items.map(({ localizedContent, localizedActivity, ...item }) => {
    const body = readNativeMessage(localizedContent);
    const hostGoalPrompt = body?.key === 'native.goal.resumePrompt' && item.role === 'user'
      && item.status === 'completed' && item.toolName === null && typeof item.turnId === 'string' && item.turnId.length > 0;
    let content = body && (hostGoalPrompt || (item.role === 'system' && !['native.background.forkActivity','native.subagent.interruptedActivity','native.goal.resumePrompt'].includes(body.key)))
      ? translateMessage(locale, body) : item.content;
    const activity = readNativeMessage(localizedActivity);
    if (item.role === 'system' && item.toolName === 'subagent' && item.status === 'failed' && activity?.key === 'native.subagent.interruptedActivity') {
      const task = parseSubagent(item.content);
      if (task?.status === 'interrupted') content = JSON.stringify({...task, activity:translateMessage(locale, activity)});
    }
    if (item.role === 'system' && item.toolName === 'background_task' && item.status === 'failed' && activity?.key === 'native.background.forkActivity') {
      try {
        const task = JSON.parse(item.content);
        if (task?.status === 'unknown' && ['id','rootTurnId','name','command','activity'].every(key=>typeof task[key] === 'string')) {
          content = JSON.stringify({...task, activity:translateMessage(locale, activity)});
        }
      } catch { /* Invalid task snapshots retain their original body. */ }
    }
    return {...item, content};
  });
}

export function turnChangeSetPresentation(changeSet: TurnChangeSet | null, locale: Locale): Omit<TurnChangeSet,'localizedCaptureError'> | null {
  if (!changeSet) return null;
  const {localizedCaptureError, ...value} = changeSet;
  return {...value, captureError:value.captureError === null ? null : translateMessage(locale,readNativeMessage(localizedCaptureError) ?? value.captureError)};
}

export function checkpointsPresentation(items: CheckpointFile[], locale: Locale): Omit<CheckpointFile,'localizedReason'>[] {
  return items.map(({localizedReason, ...item}) => ({...item,
    reason:item.reason === null ? null : translateMessage(locale,readNativeMessage(localizedReason) ?? item.reason),
  }));
}
