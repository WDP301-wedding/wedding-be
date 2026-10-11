export type TemplateSelectionFacts = Readonly<{
  templateId: string;
  templateVersionId: string;
  revision: number;
  title: string;
}>;
export type TemplateSelectionReference = Readonly<{
  templateId: string;
  templateVersionId: string;
}>;
/** Commercial catalog facts only. No designs, text fields, assets, Storage or writers. */
export interface InvitationTemplateSelectionReader {
  requireSelection(input: TemplateSelectionReference): Promise<TemplateSelectionFacts>;
  /** Up to 50 exact references; inactive, missing and superseded sources are omitted. */
  findSelectableSelections(
    inputs: readonly TemplateSelectionReference[],
  ): Promise<readonly TemplateSelectionFacts[]>;
  resolveVersion(templateVersionId: string): Promise<TemplateSelectionFacts>;
}
