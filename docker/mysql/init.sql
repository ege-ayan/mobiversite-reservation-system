-- prisma migrate dev creates a shadow database outside the app schema.
GRANT CREATE, DROP, ALTER, INDEX, REFERENCES ON *.* TO 'mobiversite'@'%';
FLUSH PRIVILEGES;
