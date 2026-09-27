/** Validates host image descriptors and returns ACP image content blocks. `label` names the agent in errors. */
export declare function imageInput(attachments?: readonly unknown[], supported?: boolean, label?: string): { type: 'image'; mimeType: string; data: string }[];
