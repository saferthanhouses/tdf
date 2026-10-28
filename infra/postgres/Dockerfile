# Postgres with pgBackRest, which has to live in the same container because Postgres runs
# archive_command itself. The official image already carries the PGDG apt repository.
# Rebuild with --pull to pick up Postgres minor releases.
ARG PG_IMAGE=postgres:18
FROM ${PG_IMAGE}

RUN apt-get update \
	&& apt-get install -y --no-install-recommends pgbackrest ca-certificates \
	&& rm -rf /var/lib/apt/lists/* \
	&& install -d -o postgres -g postgres -m 750 /var/log/pgbackrest /var/spool/pgbackrest /var/lib/pgbackrest /tmp/pgbackrest
