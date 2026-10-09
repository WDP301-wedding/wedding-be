# Cross-project UI work

When editing the sibling `wedding-web`, `wedding-manage-web` or `wedding-app` project, read that project's instructions and apply the `wedding-design-system` skill.

Vietnamese browser UI must use the shared Be Vietnam Pro sans-serif tokens, preserve authored case and use normal letter spacing. Never override these tokens with serif fonts, including fallbacks. Serif treatment is limited to explicitly Latin-only brand elements. These requirements take precedence over generic serif or uppercase suggestions in design references.

Both web projects have `src/design-system/typography.test.ts`; run it with the normal checks whenever changing UI. Also inspect actual Vietnamese glyphs at desktop and mobile widths, especially “Điều phối đặt tiệc”, “Hồ sơ tư vấn” and “Đề xuất & vòng đời”.
