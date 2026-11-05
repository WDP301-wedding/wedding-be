-- Add 3 layout templates for Lotus Hall: 15 tables (150 seats), 18 tables (180 seats), 25 tables (250 seats)

-- Disable user triggers during catalog insertion to prevent deferred constraint trigger aborts
ALTER TABLE "LayoutTemplate" DISABLE TRIGGER USER;
ALTER TABLE "LayoutTemplateVersion" DISABLE TRIGGER USER;
ALTER TABLE "LayoutTableIdentity" DISABLE TRIGGER USER;
ALTER TABLE "LayoutTableGeometry" DISABLE TRIGGER USER;

-- =============================================================================
-- Lotus — 15 bàn, 150 chỗ
-- =============================================================================
INSERT INTO "LayoutTemplate" ("id", "hallId", "displayOrder", "createdByAccountId", "updatedByAccountId", "createdAt", "updatedAt")
VALUES ('31506e52-ea3d-5fb3-a418-f1b3293450ce', '10000000-0000-4000-8000-000000000010', 14, '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTemplateVersion" ("id", "layoutTemplateId", "versionNumber", "state", "name", "description", "minGuests", "maxGuests", "createdByAccountId", "publishedAt", "createdAt", "updatedAt")
VALUES ('fff81db5-c6ad-5b8f-ae85-da3abef9e953', '31506e52-ea3d-5fb3-a418-f1b3293450ce', 1, 'PUBLISHED', 'Lotus — 15 bàn, 150 chỗ', 'Mẫu bàn tròn 10 chỗ. Phía trên chừa sân khấu; khoảng giữa chừa lối đi. Số khách dự kiến do Couple/Manager nhập riêng.', 101, 150, '10000000-0000-4000-8000-000000000001', NOW(), NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

UPDATE "LayoutTemplate" SET "currentPublishedVersionId" = 'fff81db5-c6ad-5b8f-ae85-da3abef9e953', "updatedAt" = NOW() WHERE "id" = '31506e52-ea3d-5fb3-a418-f1b3293450ce';

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('a74fef0b-4fdb-576a-aaa8-e9df72d9993e', '31506e52-ea3d-5fb3-a418-f1b3293450ce', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('69adb61c-3c1f-5cb8-ad75-6e69bf7d1dd6', 'fff81db5-c6ad-5b8f-ae85-da3abef9e953', '31506e52-ea3d-5fb3-a418-f1b3293450ce', 'a74fef0b-4fdb-576a-aaa8-e9df72d9993e', 'Bàn 01', 'ROUND', 10, 600, 2000, 650, 650, 0, 1)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('f360cda9-45c2-58b7-a8f9-7582a6460b42', '31506e52-ea3d-5fb3-a418-f1b3293450ce', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('2c2e1bd0-f1d8-5565-a557-ac0e948a8e26', 'fff81db5-c6ad-5b8f-ae85-da3abef9e953', '31506e52-ea3d-5fb3-a418-f1b3293450ce', 'f360cda9-45c2-58b7-a8f9-7582a6460b42', 'Bàn 02', 'ROUND', 10, 1700, 2000, 650, 650, 0, 2)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('d1207201-8fe2-5aa2-a9e6-9eeeb4a6cea2', '31506e52-ea3d-5fb3-a418-f1b3293450ce', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('38cfc063-362b-5269-ab5f-d90ecf0e5124', 'fff81db5-c6ad-5b8f-ae85-da3abef9e953', '31506e52-ea3d-5fb3-a418-f1b3293450ce', 'd1207201-8fe2-5aa2-a9e6-9eeeb4a6cea2', 'Bàn 03', 'ROUND', 10, 4000, 2000, 650, 650, 0, 3)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('c1285231-83ee-5793-a044-936751a9af89', '31506e52-ea3d-5fb3-a418-f1b3293450ce', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('b40baddc-87d5-55d3-aafd-5d4d0050e7c5', 'fff81db5-c6ad-5b8f-ae85-da3abef9e953', '31506e52-ea3d-5fb3-a418-f1b3293450ce', 'c1285231-83ee-5793-a044-936751a9af89', 'Bàn 04', 'ROUND', 10, 5100, 2000, 650, 650, 0, 4)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('5d78f25a-30c7-5f37-acf6-ebb9dfcf92d8', '31506e52-ea3d-5fb3-a418-f1b3293450ce', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('e6bb7813-bf3d-5388-a745-c4b10376a0e1', 'fff81db5-c6ad-5b8f-ae85-da3abef9e953', '31506e52-ea3d-5fb3-a418-f1b3293450ce', '5d78f25a-30c7-5f37-acf6-ebb9dfcf92d8', 'Bàn 05', 'ROUND', 10, 600, 3200, 650, 650, 0, 5)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('2135e57f-98bf-52eb-a7b9-5d029780611e', '31506e52-ea3d-5fb3-a418-f1b3293450ce', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('b8b5933d-54e9-50ff-ab8f-6a0c835ab707', 'fff81db5-c6ad-5b8f-ae85-da3abef9e953', '31506e52-ea3d-5fb3-a418-f1b3293450ce', '2135e57f-98bf-52eb-a7b9-5d029780611e', 'Bàn 06', 'ROUND', 10, 1700, 3200, 650, 650, 0, 6)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('96370265-6392-54cc-a59a-9effbc01f152', '31506e52-ea3d-5fb3-a418-f1b3293450ce', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('322da3ec-4421-5e1e-a784-0ac1351887a3', 'fff81db5-c6ad-5b8f-ae85-da3abef9e953', '31506e52-ea3d-5fb3-a418-f1b3293450ce', '96370265-6392-54cc-a59a-9effbc01f152', 'Bàn 07', 'ROUND', 10, 4000, 3200, 650, 650, 0, 7)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('998d6da3-f5e3-5664-af1a-21edc200b3d3', '31506e52-ea3d-5fb3-a418-f1b3293450ce', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('abb9ff6a-d87c-5b38-a98f-5e4462d40ede', 'fff81db5-c6ad-5b8f-ae85-da3abef9e953', '31506e52-ea3d-5fb3-a418-f1b3293450ce', '998d6da3-f5e3-5664-af1a-21edc200b3d3', 'Bàn 08', 'ROUND', 10, 5100, 3200, 650, 650, 0, 8)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('b76602f2-09c1-5f41-a19b-03990977e8e2', '31506e52-ea3d-5fb3-a418-f1b3293450ce', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('2229942c-d613-595d-a19d-2181547497e5', 'fff81db5-c6ad-5b8f-ae85-da3abef9e953', '31506e52-ea3d-5fb3-a418-f1b3293450ce', 'b76602f2-09c1-5f41-a19b-03990977e8e2', 'Bàn 09', 'ROUND', 10, 600, 4400, 650, 650, 0, 9)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('a9459ca4-e174-53dd-a2f5-af3b0d218d9d', '31506e52-ea3d-5fb3-a418-f1b3293450ce', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('b1c4cf16-baf0-51c8-a662-b77c7f6eb3d2', 'fff81db5-c6ad-5b8f-ae85-da3abef9e953', '31506e52-ea3d-5fb3-a418-f1b3293450ce', 'a9459ca4-e174-53dd-a2f5-af3b0d218d9d', 'Bàn 10', 'ROUND', 10, 1700, 4400, 650, 650, 0, 10)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('2a14215b-b25f-5a75-a91c-db09b29a078a', '31506e52-ea3d-5fb3-a418-f1b3293450ce', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('d5458aca-6e63-59fe-afff-4f7e17e74ec4', 'fff81db5-c6ad-5b8f-ae85-da3abef9e953', '31506e52-ea3d-5fb3-a418-f1b3293450ce', '2a14215b-b25f-5a75-a91c-db09b29a078a', 'Bàn 11', 'ROUND', 10, 4000, 4400, 650, 650, 0, 11)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('519bed19-0ddf-540d-a8d9-6653c4f592ec', '31506e52-ea3d-5fb3-a418-f1b3293450ce', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('51f2b41c-6847-5b63-acb1-2e7d1bea575c', 'fff81db5-c6ad-5b8f-ae85-da3abef9e953', '31506e52-ea3d-5fb3-a418-f1b3293450ce', '519bed19-0ddf-540d-a8d9-6653c4f592ec', 'Bàn 12', 'ROUND', 10, 5100, 4400, 650, 650, 0, 12)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('735a030f-e758-576a-a85c-06648cf6d025', '31506e52-ea3d-5fb3-a418-f1b3293450ce', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('396a0d9f-673e-5485-a470-5883e5082483', 'fff81db5-c6ad-5b8f-ae85-da3abef9e953', '31506e52-ea3d-5fb3-a418-f1b3293450ce', '735a030f-e758-576a-a85c-06648cf6d025', 'Bàn 13', 'ROUND', 10, 600, 5600, 650, 650, 0, 13)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('2e9edf72-d070-55ea-a755-ea00c33218f3', '31506e52-ea3d-5fb3-a418-f1b3293450ce', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('56a71c6f-23b9-5518-a521-69d0514b9b16', 'fff81db5-c6ad-5b8f-ae85-da3abef9e953', '31506e52-ea3d-5fb3-a418-f1b3293450ce', '2e9edf72-d070-55ea-a755-ea00c33218f3', 'Bàn 14', 'ROUND', 10, 1700, 5600, 650, 650, 0, 14)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('7cc293a1-e394-5528-a81d-e795b3034b77', '31506e52-ea3d-5fb3-a418-f1b3293450ce', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('bd72bd7f-c97e-55ce-a30c-f3217b814f0d', 'fff81db5-c6ad-5b8f-ae85-da3abef9e953', '31506e52-ea3d-5fb3-a418-f1b3293450ce', '7cc293a1-e394-5528-a81d-e795b3034b77', 'Bàn 15', 'ROUND', 10, 4000, 5600, 650, 650, 0, 15)
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- Lotus — 18 bàn, 180 chỗ
-- =============================================================================
INSERT INTO "LayoutTemplate" ("id", "hallId", "displayOrder", "createdByAccountId", "updatedByAccountId", "createdAt", "updatedAt")
VALUES ('2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '10000000-0000-4000-8000-000000000010', 15, '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTemplateVersion" ("id", "layoutTemplateId", "versionNumber", "state", "name", "description", "minGuests", "maxGuests", "createdByAccountId", "publishedAt", "createdAt", "updatedAt")
VALUES ('86d3b2dc-2a79-5fbf-a073-5b68a506eb7b', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', 1, 'PUBLISHED', 'Lotus — 18 bàn, 180 chỗ', 'Mẫu bàn tròn 10 chỗ. Phía trên chừa sân khấu; khoảng giữa chừa lối đi. Số khách dự kiến do Couple/Manager nhập riêng.', 121, 180, '10000000-0000-4000-8000-000000000001', NOW(), NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

UPDATE "LayoutTemplate" SET "currentPublishedVersionId" = '86d3b2dc-2a79-5fbf-a073-5b68a506eb7b', "updatedAt" = NOW() WHERE "id" = '2055463d-d0d6-57a7-a23f-cf1120d1a1b2';

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('6639312f-a570-5a1d-ac26-52c187efb1f8', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('6596f519-aa4a-5f78-a5c7-eb367c102b76', '86d3b2dc-2a79-5fbf-a073-5b68a506eb7b', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '6639312f-a570-5a1d-ac26-52c187efb1f8', 'Bàn 01', 'ROUND', 10, 600, 2000, 650, 650, 0, 1)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('4b50f478-ce57-5866-a227-300cfbebdc15', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('638e1d01-d4c0-5f4a-ad52-81e33da1cca9', '86d3b2dc-2a79-5fbf-a073-5b68a506eb7b', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '4b50f478-ce57-5866-a227-300cfbebdc15', 'Bàn 02', 'ROUND', 10, 1700, 2000, 650, 650, 0, 2)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('71d68df3-b31d-55b0-a07d-755adfd600db', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('8a9bf18d-eaa4-59c5-ac91-13ee8f8ca043', '86d3b2dc-2a79-5fbf-a073-5b68a506eb7b', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '71d68df3-b31d-55b0-a07d-755adfd600db', 'Bàn 03', 'ROUND', 10, 4000, 2000, 650, 650, 0, 3)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('57105cff-bd71-5ec2-a41b-79c145b5e515', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('253b1e1b-22b5-580f-aed7-5b5ad3d2a926', '86d3b2dc-2a79-5fbf-a073-5b68a506eb7b', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '57105cff-bd71-5ec2-a41b-79c145b5e515', 'Bàn 04', 'ROUND', 10, 5100, 2000, 650, 650, 0, 4)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('b56a5f33-922c-5ae6-ab89-75bd5ed75034', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('237dab01-ab9c-5498-afbe-edfc20860eb5', '86d3b2dc-2a79-5fbf-a073-5b68a506eb7b', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', 'b56a5f33-922c-5ae6-ab89-75bd5ed75034', 'Bàn 05', 'ROUND', 10, 600, 3200, 650, 650, 0, 5)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('e8295749-d2fa-5fd9-a9c0-5febc386988a', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('332ee9aa-802d-58e3-a678-ab2b662b2b49', '86d3b2dc-2a79-5fbf-a073-5b68a506eb7b', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', 'e8295749-d2fa-5fd9-a9c0-5febc386988a', 'Bàn 06', 'ROUND', 10, 1700, 3200, 650, 650, 0, 6)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('3c693131-7768-5aab-a550-8ea7576bc871', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('3554ca77-a5d2-52d2-ad9b-2ada3b51356f', '86d3b2dc-2a79-5fbf-a073-5b68a506eb7b', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '3c693131-7768-5aab-a550-8ea7576bc871', 'Bàn 07', 'ROUND', 10, 4000, 3200, 650, 650, 0, 7)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('cb78fdc0-4455-5653-a3f4-c447c4c552d9', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('741649ce-52d2-5c47-a2de-373511a83472', '86d3b2dc-2a79-5fbf-a073-5b68a506eb7b', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', 'cb78fdc0-4455-5653-a3f4-c447c4c552d9', 'Bàn 08', 'ROUND', 10, 5100, 3200, 650, 650, 0, 8)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('149126c1-5bd8-52b3-ac37-a8c42c40e2f5', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('40c4bf95-04b2-59a9-a2b9-f0feb2c0734f', '86d3b2dc-2a79-5fbf-a073-5b68a506eb7b', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '149126c1-5bd8-52b3-ac37-a8c42c40e2f5', 'Bàn 09', 'ROUND', 10, 600, 4400, 650, 650, 0, 9)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('6ec74090-4882-5b02-a45c-a0b9d7648971', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('d5318ac3-8094-5e57-af37-0128920f5ffe', '86d3b2dc-2a79-5fbf-a073-5b68a506eb7b', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '6ec74090-4882-5b02-a45c-a0b9d7648971', 'Bàn 10', 'ROUND', 10, 1700, 4400, 650, 650, 0, 10)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('731afd3c-cd2f-5f53-ab61-4f08d8f7f855', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('32f4ed47-edd6-5298-aef3-fcb0ec2b9f56', '86d3b2dc-2a79-5fbf-a073-5b68a506eb7b', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '731afd3c-cd2f-5f53-ab61-4f08d8f7f855', 'Bàn 11', 'ROUND', 10, 4000, 4400, 650, 650, 0, 11)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('dd1a0408-f453-57b0-a067-b5a14fbb5f58', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('38518f73-1f78-5edb-abb9-3ad27eb8bbe7', '86d3b2dc-2a79-5fbf-a073-5b68a506eb7b', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', 'dd1a0408-f453-57b0-a067-b5a14fbb5f58', 'Bàn 12', 'ROUND', 10, 5100, 4400, 650, 650, 0, 12)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('f51d7dcc-25b9-59ff-accc-35dd7b3cb8c0', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('ce132edd-c096-5838-ad1b-7c5c11ea2f38', '86d3b2dc-2a79-5fbf-a073-5b68a506eb7b', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', 'f51d7dcc-25b9-59ff-accc-35dd7b3cb8c0', 'Bàn 13', 'ROUND', 10, 600, 5600, 650, 650, 0, 13)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('d1d19cf9-86bf-5d6c-ab69-565469ac4fe9', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('6cc42316-6aa5-5e03-a8a7-671fac4f9544', '86d3b2dc-2a79-5fbf-a073-5b68a506eb7b', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', 'd1d19cf9-86bf-5d6c-ab69-565469ac4fe9', 'Bàn 14', 'ROUND', 10, 1700, 5600, 650, 650, 0, 14)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('c722070b-e9da-5067-aab6-a75971b9ae46', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('f7cf11e4-a298-5017-a36d-d3e02587fc26', '86d3b2dc-2a79-5fbf-a073-5b68a506eb7b', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', 'c722070b-e9da-5067-aab6-a75971b9ae46', 'Bàn 15', 'ROUND', 10, 4000, 5600, 650, 650, 0, 15)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('039cf0e5-4273-5ff8-a3fb-36a058004a74', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('390b4445-013d-545d-ab86-6cb63507136e', '86d3b2dc-2a79-5fbf-a073-5b68a506eb7b', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '039cf0e5-4273-5ff8-a3fb-36a058004a74', 'Bàn 16', 'ROUND', 10, 5100, 5600, 650, 650, 0, 16)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('cb80b9c7-34c7-5cc6-a0a2-ef2a233e224d', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('5dd2d6f5-6ec3-511a-a35a-85b7e4d3512a', '86d3b2dc-2a79-5fbf-a073-5b68a506eb7b', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', 'cb80b9c7-34c7-5cc6-a0a2-ef2a233e224d', 'Bàn 17', 'ROUND', 10, 600, 6800, 650, 650, 0, 17)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('326de809-2308-5dd6-a1ff-ad936609329f', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('1d57cf05-01c7-5922-a401-e61939107d36', '86d3b2dc-2a79-5fbf-a073-5b68a506eb7b', '2055463d-d0d6-57a7-a23f-cf1120d1a1b2', '326de809-2308-5dd6-a1ff-ad936609329f', 'Bàn 18', 'ROUND', 10, 1700, 6800, 650, 650, 0, 18)
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- Lotus — 25 bàn, 250 chỗ
-- =============================================================================
INSERT INTO "LayoutTemplate" ("id", "hallId", "displayOrder", "createdByAccountId", "updatedByAccountId", "createdAt", "updatedAt")
VALUES ('7e8e64bc-4278-53c3-a445-04a4c0161045', '10000000-0000-4000-8000-000000000010', 16, '10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTemplateVersion" ("id", "layoutTemplateId", "versionNumber", "state", "name", "description", "minGuests", "maxGuests", "createdByAccountId", "publishedAt", "createdAt", "updatedAt")
VALUES ('ff3502c4-03e1-584f-a988-70ba82ecdb50', '7e8e64bc-4278-53c3-a445-04a4c0161045', 1, 'PUBLISHED', 'Lotus — 25 bàn, 250 chỗ', 'Mẫu bàn tròn 10 chỗ. Phía trên chừa sân khấu; khoảng giữa chừa lối đi. Số khách dự kiến do Couple/Manager nhập riêng.', 181, 250, '10000000-0000-4000-8000-000000000001', NOW(), NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

UPDATE "LayoutTemplate" SET "currentPublishedVersionId" = 'ff3502c4-03e1-584f-a988-70ba82ecdb50', "updatedAt" = NOW() WHERE "id" = '7e8e64bc-4278-53c3-a445-04a4c0161045';

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('aa07902b-244e-50da-acbd-f118adadb708', '7e8e64bc-4278-53c3-a445-04a4c0161045', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('cb72dfd8-f155-5f75-aa8d-c17bac4707fe', 'ff3502c4-03e1-584f-a988-70ba82ecdb50', '7e8e64bc-4278-53c3-a445-04a4c0161045', 'aa07902b-244e-50da-acbd-f118adadb708', 'Bàn 01', 'ROUND', 10, 600, 2000, 650, 650, 0, 1)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('55522548-e553-5148-afd8-27a54ce3f4f5', '7e8e64bc-4278-53c3-a445-04a4c0161045', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('9d97d472-c8fa-5f74-a1fc-4e2f070202e3', 'ff3502c4-03e1-584f-a988-70ba82ecdb50', '7e8e64bc-4278-53c3-a445-04a4c0161045', '55522548-e553-5148-afd8-27a54ce3f4f5', 'Bàn 02', 'ROUND', 10, 1700, 2000, 650, 650, 0, 2)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('abd91a84-0090-5158-a3b6-6fd9af384bdb', '7e8e64bc-4278-53c3-a445-04a4c0161045', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('21ba3ed4-ca72-5329-a6b3-3a901804a942', 'ff3502c4-03e1-584f-a988-70ba82ecdb50', '7e8e64bc-4278-53c3-a445-04a4c0161045', 'abd91a84-0090-5158-a3b6-6fd9af384bdb', 'Bàn 03', 'ROUND', 10, 2800, 2000, 650, 650, 0, 3)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('0146ca54-69c1-59a4-a7f9-ead7e424fdcd', '7e8e64bc-4278-53c3-a445-04a4c0161045', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('ca2e63b9-7c75-534d-ad1d-bb6f88e8bd36', 'ff3502c4-03e1-584f-a988-70ba82ecdb50', '7e8e64bc-4278-53c3-a445-04a4c0161045', '0146ca54-69c1-59a4-a7f9-ead7e424fdcd', 'Bàn 04', 'ROUND', 10, 5100, 2000, 650, 650, 0, 4)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('83330c27-efa1-5fca-aa69-c025c2e58f35', '7e8e64bc-4278-53c3-a445-04a4c0161045', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('e80c7666-717d-5a7a-af57-3a278db41150', 'ff3502c4-03e1-584f-a988-70ba82ecdb50', '7e8e64bc-4278-53c3-a445-04a4c0161045', '83330c27-efa1-5fca-aa69-c025c2e58f35', 'Bàn 05', 'ROUND', 10, 6200, 2000, 650, 650, 0, 5)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('f532c7af-2797-518a-ad6f-1db3d16f88ee', '7e8e64bc-4278-53c3-a445-04a4c0161045', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('5037a631-1a86-5515-a0ab-9d141170d7d2', 'ff3502c4-03e1-584f-a988-70ba82ecdb50', '7e8e64bc-4278-53c3-a445-04a4c0161045', 'f532c7af-2797-518a-ad6f-1db3d16f88ee', 'Bàn 06', 'ROUND', 10, 7300, 2000, 650, 650, 0, 6)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('f4f75f9f-2af1-5499-a0b8-3a17edced039', '7e8e64bc-4278-53c3-a445-04a4c0161045', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('c5ccd0ea-fe0f-536e-afe1-a4e6af38db92', 'ff3502c4-03e1-584f-a988-70ba82ecdb50', '7e8e64bc-4278-53c3-a445-04a4c0161045', 'f4f75f9f-2af1-5499-a0b8-3a17edced039', 'Bàn 07', 'ROUND', 10, 600, 3200, 650, 650, 0, 7)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('2d1c960e-5d16-5efb-ae55-7faa6368a39c', '7e8e64bc-4278-53c3-a445-04a4c0161045', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('3272856b-d3c9-5372-ad19-f95c76ee0a68', 'ff3502c4-03e1-584f-a988-70ba82ecdb50', '7e8e64bc-4278-53c3-a445-04a4c0161045', '2d1c960e-5d16-5efb-ae55-7faa6368a39c', 'Bàn 08', 'ROUND', 10, 1700, 3200, 650, 650, 0, 8)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('2fb23548-69db-5115-a6e4-a0eac621d3f3', '7e8e64bc-4278-53c3-a445-04a4c0161045', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('db017411-6184-50b1-aaa3-9d36b1830c19', 'ff3502c4-03e1-584f-a988-70ba82ecdb50', '7e8e64bc-4278-53c3-a445-04a4c0161045', '2fb23548-69db-5115-a6e4-a0eac621d3f3', 'Bàn 09', 'ROUND', 10, 2800, 3200, 650, 650, 0, 9)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('9bb1d061-7cda-5ec3-a443-86106144ab6b', '7e8e64bc-4278-53c3-a445-04a4c0161045', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('6b04f6af-cca0-581e-a593-63cea4ed94fb', 'ff3502c4-03e1-584f-a988-70ba82ecdb50', '7e8e64bc-4278-53c3-a445-04a4c0161045', '9bb1d061-7cda-5ec3-a443-86106144ab6b', 'Bàn 10', 'ROUND', 10, 5100, 3200, 650, 650, 0, 10)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('4815af15-65e8-5cad-abd5-7eb5c1580b10', '7e8e64bc-4278-53c3-a445-04a4c0161045', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('a10638cd-2ce2-57ff-a707-7bad6cc2a92c', 'ff3502c4-03e1-584f-a988-70ba82ecdb50', '7e8e64bc-4278-53c3-a445-04a4c0161045', '4815af15-65e8-5cad-abd5-7eb5c1580b10', 'Bàn 11', 'ROUND', 10, 6200, 3200, 650, 650, 0, 11)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('98a47559-09b9-5901-aa1a-a05d37148671', '7e8e64bc-4278-53c3-a445-04a4c0161045', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('65de0ec9-d429-5d3f-a100-8d3800bf01f3', 'ff3502c4-03e1-584f-a988-70ba82ecdb50', '7e8e64bc-4278-53c3-a445-04a4c0161045', '98a47559-09b9-5901-aa1a-a05d37148671', 'Bàn 12', 'ROUND', 10, 7300, 3200, 650, 650, 0, 12)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('6cec400f-18ef-54a9-a9c2-b5a43d381992', '7e8e64bc-4278-53c3-a445-04a4c0161045', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('2c3241ff-e6a3-55d8-a847-a4fd864b5a4f', 'ff3502c4-03e1-584f-a988-70ba82ecdb50', '7e8e64bc-4278-53c3-a445-04a4c0161045', '6cec400f-18ef-54a9-a9c2-b5a43d381992', 'Bàn 13', 'ROUND', 10, 600, 4400, 650, 650, 0, 13)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('8acf0963-b394-56e0-aeed-f68c2af32782', '7e8e64bc-4278-53c3-a445-04a4c0161045', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('d56b6018-2575-526d-a4c4-ae9ad40daa7b', 'ff3502c4-03e1-584f-a988-70ba82ecdb50', '7e8e64bc-4278-53c3-a445-04a4c0161045', '8acf0963-b394-56e0-aeed-f68c2af32782', 'Bàn 14', 'ROUND', 10, 1700, 4400, 650, 650, 0, 14)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('b44ea1e0-0e51-5c41-a5a0-820307090624', '7e8e64bc-4278-53c3-a445-04a4c0161045', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('39de0fd5-9d02-5802-a19c-b9499f8f00bf', 'ff3502c4-03e1-584f-a988-70ba82ecdb50', '7e8e64bc-4278-53c3-a445-04a4c0161045', 'b44ea1e0-0e51-5c41-a5a0-820307090624', 'Bàn 15', 'ROUND', 10, 2800, 4400, 650, 650, 0, 15)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('27944262-9d12-5d6c-a1fd-14a06d79d650', '7e8e64bc-4278-53c3-a445-04a4c0161045', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('9b234da3-0bc5-5047-a8d3-f4aa5e5e3e3f', 'ff3502c4-03e1-584f-a988-70ba82ecdb50', '7e8e64bc-4278-53c3-a445-04a4c0161045', '27944262-9d12-5d6c-a1fd-14a06d79d650', 'Bàn 16', 'ROUND', 10, 5100, 4400, 650, 650, 0, 16)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('9e670991-ec13-5291-af0b-bfa67d6262ff', '7e8e64bc-4278-53c3-a445-04a4c0161045', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('21b34316-195c-574a-abb4-e92caaa134ea', 'ff3502c4-03e1-584f-a988-70ba82ecdb50', '7e8e64bc-4278-53c3-a445-04a4c0161045', '9e670991-ec13-5291-af0b-bfa67d6262ff', 'Bàn 17', 'ROUND', 10, 6200, 4400, 650, 650, 0, 17)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('fb19ad7d-679d-5b88-a2ca-f394c9131228', '7e8e64bc-4278-53c3-a445-04a4c0161045', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('2c157aea-287d-5dd1-a67e-d8eb03aa89e2', 'ff3502c4-03e1-584f-a988-70ba82ecdb50', '7e8e64bc-4278-53c3-a445-04a4c0161045', 'fb19ad7d-679d-5b88-a2ca-f394c9131228', 'Bàn 18', 'ROUND', 10, 7300, 4400, 650, 650, 0, 18)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('d0180015-1e23-5b26-aba6-2278dbdad72e', '7e8e64bc-4278-53c3-a445-04a4c0161045', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('a7a1aa2b-8da0-5869-ab3d-757418609c96', 'ff3502c4-03e1-584f-a988-70ba82ecdb50', '7e8e64bc-4278-53c3-a445-04a4c0161045', 'd0180015-1e23-5b26-aba6-2278dbdad72e', 'Bàn 19', 'ROUND', 10, 600, 5600, 650, 650, 0, 19)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('ff69e54d-2629-5c59-aa73-a27d2571e267', '7e8e64bc-4278-53c3-a445-04a4c0161045', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('2ab1869e-b0ea-5c6d-a822-60e4a8c75ce0', 'ff3502c4-03e1-584f-a988-70ba82ecdb50', '7e8e64bc-4278-53c3-a445-04a4c0161045', 'ff69e54d-2629-5c59-aa73-a27d2571e267', 'Bàn 20', 'ROUND', 10, 1700, 5600, 650, 650, 0, 20)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('7911f3ec-9ec2-5cbd-a706-38fa561f42dc', '7e8e64bc-4278-53c3-a445-04a4c0161045', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('45456dc0-f516-5a16-a9fa-3e120d9f219f', 'ff3502c4-03e1-584f-a988-70ba82ecdb50', '7e8e64bc-4278-53c3-a445-04a4c0161045', '7911f3ec-9ec2-5cbd-a706-38fa561f42dc', 'Bàn 21', 'ROUND', 10, 2800, 5600, 650, 650, 0, 21)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('0ea555c7-adb7-5491-ae03-1924deead557', '7e8e64bc-4278-53c3-a445-04a4c0161045', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('513bfbf6-0012-5dca-a056-f00985f973e6', 'ff3502c4-03e1-584f-a988-70ba82ecdb50', '7e8e64bc-4278-53c3-a445-04a4c0161045', '0ea555c7-adb7-5491-ae03-1924deead557', 'Bàn 22', 'ROUND', 10, 5100, 5600, 650, 650, 0, 22)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('319dba02-3d7f-5cc6-af8b-b6fe291611aa', '7e8e64bc-4278-53c3-a445-04a4c0161045', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('130f4622-a4f9-58a2-a887-5f7ceb69a925', 'ff3502c4-03e1-584f-a988-70ba82ecdb50', '7e8e64bc-4278-53c3-a445-04a4c0161045', '319dba02-3d7f-5cc6-af8b-b6fe291611aa', 'Bàn 23', 'ROUND', 10, 6200, 5600, 650, 650, 0, 23)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('256e925a-7381-5d2c-a3af-82d6ccb88ea8', '7e8e64bc-4278-53c3-a445-04a4c0161045', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('5cf4b7f2-34b3-5d95-af16-c807123f5c6a', 'ff3502c4-03e1-584f-a988-70ba82ecdb50', '7e8e64bc-4278-53c3-a445-04a4c0161045', '256e925a-7381-5d2c-a3af-82d6ccb88ea8', 'Bàn 24', 'ROUND', 10, 7300, 5600, 650, 650, 0, 24)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "LayoutTableIdentity" ("id", "layoutTemplateId", "createdByAccountId", "createdAt")
VALUES ('14d5b068-534c-5daa-ad0d-d75e3d32372b', '7e8e64bc-4278-53c3-a445-04a4c0161045', '10000000-0000-4000-8000-000000000001', NOW())
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "LayoutTableGeometry" ("id", "layoutTemplateVersionId", "layoutTemplateId", "tableId", "label", "shape", "seatCapacity", "x", "y", "width", "height", "rotationDegrees", "displayOrder")
VALUES ('17e85004-2bf4-5ed1-aec5-84c1341bcac4', 'ff3502c4-03e1-584f-a988-70ba82ecdb50', '7e8e64bc-4278-53c3-a445-04a4c0161045', '14d5b068-534c-5daa-ad0d-d75e3d32372b', 'Bàn 25', 'ROUND', 10, 600, 6800, 650, 650, 0, 25)
ON CONFLICT ("id") DO NOTHING;

-- Re-enable user triggers
ALTER TABLE "LayoutTableGeometry" ENABLE TRIGGER USER;
ALTER TABLE "LayoutTableIdentity" ENABLE TRIGGER USER;
ALTER TABLE "LayoutTemplateVersion" ENABLE TRIGGER USER;
ALTER TABLE "LayoutTemplate" ENABLE TRIGGER USER;


