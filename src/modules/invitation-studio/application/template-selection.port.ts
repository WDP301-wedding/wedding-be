export type TemplateSelectionFacts = Readonly<{
  templateId: string;
  templateVersionId: string;
  revision: number;
  title: string;
}>;
/** Commercial catalog facts only. No designs, text fields, assets, Storage or writers. */
export interface InvitationTemplateSelectionReader {
  requireSelection(
    input: Readonly<{ templateId: string; templateVersionId: string }>,
  ): Promise<TemplateSelectionFacts>;
  resolveVersion(templateVersionId: string): Promise<TemplateSelectionFacts>;
}
