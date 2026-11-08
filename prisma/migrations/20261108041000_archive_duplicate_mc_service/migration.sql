BEGIN;
-- Retain the old revision and every historical source reference. Archive only
-- the current exact duplicate label; MC tiệc cưới remains untouched.
DO $$ DECLARE item RECORD; next_id UUID; BEGIN
  FOR item IN
    SELECT s.id,s.revision,r.name,r.description,r.unit,r."unitPriceVnd"
    FROM "RestaurantService" s JOIN "RestaurantServiceRevision" r
      ON r."serviceId"=s.id AND r.revision=s.revision
    WHERE s.active AND r.name='Dịch vụ MC' ORDER BY s.id FOR UPDATE OF s
  LOOP
    next_id := gen_random_uuid();
    INSERT INTO "RestaurantServiceRevision"
      (id,"serviceId",revision,name,description,unit,"unitPriceVnd",active,"actorId")
    VALUES(next_id,item.id,item.revision+1,item.name,item.description,item.unit,item."unitPriceVnd",false,
      '00000000-0000-4000-8000-000000000000');
    UPDATE "RestaurantService" SET active=false,revision=item.revision+1 WHERE id=item.id;
    INSERT INTO "AuditLog"(id,"requestId","actorType",action,"entityType","entityId",metadata)
    VALUES(gen_random_uuid(),gen_random_uuid(),'SYSTEM','venue.service-archived','restaurant-service',item.id,
      jsonb_build_object('reason','Owner-approved removal of duplicate MC service, 2026-11-08',
        'predecessorRevision',item.revision,'revision',item.revision+1,'sourceRevisionId',next_id));
  END LOOP;
END $$;
COMMIT;
