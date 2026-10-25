let bootAccess = null;

export function setBootAccess(access) {
  if (bootAccess) throw new Error("Studio access has already been initialized");
  bootAccess = access;
}

export function getBootAccess() {
  if (!bootAccess) throw new Error("Studio started without verified access");
  return bootAccess;
}
