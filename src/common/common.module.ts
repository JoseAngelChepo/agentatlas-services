import { Global, Module } from '@nestjs/common';
import { RolesGuard } from './guards/roles.guard';
import { UserPatScopeGuard } from './guards/user-pat-scope.guard';

@Global()
@Module({
  providers: [RolesGuard, UserPatScopeGuard],
  exports: [RolesGuard, UserPatScopeGuard],
})
export class CommonModule {}
