/* global db */
// Executed by mongosh in the official MongoDB image, not by the Node API.
const catalogDatabase = process.env.MONGO_INITDB_DATABASE;
const catalogUser = process.env.CATALOG_MONGO_USERNAME;
const catalogPassword = process.env.CATALOG_MONGO_PASSWORD;
if (!catalogDatabase || !catalogUser || !catalogPassword || catalogPassword.length < 32)
  throw new Error('Complete food catalog database credentials are required.');
db.getSiblingDB(catalogDatabase).createUser({
  user: catalogUser,
  pwd: catalogPassword,
  roles: [{ role: 'readWrite', db: catalogDatabase }],
});
