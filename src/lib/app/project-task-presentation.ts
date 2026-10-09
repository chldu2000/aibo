import {translateMessage} from '../../../packages/i18n/index.js';
import type {Locale} from '../../../packages/i18n/index.js';
import type {ProjectActionRun} from '../types';
import {readNativeMessage} from './error-utils.ts';

const outputKeys = new Set(['native.project.outputRejected','native.project.outputUnknown',
  'native.project.outputCancelled','native.project.outputTruncated',
  'native.project.outputRestartApproval','native.project.outputRestartExecution']);

/** Only explicit host-owned UTF-8 ranges may change; invalid metadata keeps all raw text. */
export function projectTaskOutput(output: string, metadata: unknown, locale: Locale): string {
  if (!metadata || typeof metadata !== 'object' || !('schema' in metadata)
    || metadata.schema !== 'aibo.project-output-display/v1' || !('segments' in metadata)
    || !Array.isArray(metadata.segments) || !metadata.segments.length || metadata.segments.length > 8) return output;
  const bytes = new TextEncoder().encode(output);
  const decoder = new TextDecoder('utf-8', {fatal:true,ignoreBOM:true});
  let end = 0;
  let rendered = '';
  try {
    if (decoder.decode(bytes) !== output) return output;
    for (const segment of metadata.segments) {
      if (!segment || typeof segment !== 'object' || !Number.isSafeInteger(segment.start)
        || !Number.isSafeInteger(segment.end) || segment.start < end || segment.end <= segment.start
        || segment.end > bytes.length || typeof segment.raw !== 'string') return output;
      const message = readNativeMessage(segment.message);
      if (!message || !outputKeys.has(message.key) || decoder.decode(bytes.slice(segment.start,segment.end)) !== segment.raw) return output;
      rendered += decoder.decode(bytes.slice(end,segment.start)) + translateMessage(locale,message);
      end = segment.end;
    }
    return rendered + decoder.decode(bytes.slice(end));
  } catch { return output; }
}

/** Public presentation receives plain text, without private host display metadata. */
export function projectTaskPresentation(run: ProjectActionRun, locale: Locale): ProjectActionRun {
  const {localizedOutput, ...publicRun} = run;
  return {...publicRun, output:projectTaskOutput(run.output,localizedOutput,locale)};
}
