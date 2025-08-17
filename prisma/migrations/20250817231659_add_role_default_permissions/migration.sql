-- CreateTable
CREATE TABLE "RoleDefaultPermission" (
    "id" SERIAL NOT NULL,
    "role" "UserRole" NOT NULL,
    "moduleId" INTEGER NOT NULL,
    "canAccess" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RoleDefaultPermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoleDefaultPermission_role_moduleId_key" ON "RoleDefaultPermission"("role", "moduleId");

-- AddForeignKey
ALTER TABLE "RoleDefaultPermission" ADD CONSTRAINT "RoleDefaultPermission_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
