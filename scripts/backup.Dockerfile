# The image of the backup service: the postgres image, whose pg_dump matches
# the server, with what backup.sh needs on top of it. age encrypts the dumps
# and curl sends alerts. COPY_PACKAGES are the tools BACKUP_COPY_COMMAND
# uses, rsync and ssh unless BACKUP_COPY_PACKAGES says otherwise: rclone is
# more than 100 MB, so it is only there when asked for. backup.sh itself is
# mounted, not copied in.
FROM postgres:17-alpine
ARG COPY_PACKAGES="rsync openssh-client"
RUN apk add --no-cache age curl $COPY_PACKAGES
