FROM mongo:8.0

# Official entrypoint initializes authentication and this least-privilege user
# only when /data/db is empty. Existing credentials require explicit rotation.
COPY ops/mongodb/01-catalog-user.js /docker-entrypoint-initdb.d/01-catalog-user.js
CMD ["mongod", "--bind_ip_all", "--port", "27017", "--wiredTigerCacheSizeGB", "0.25"]
