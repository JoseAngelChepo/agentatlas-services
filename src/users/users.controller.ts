import { Body, Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { Types } from 'mongoose';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { UserRole } from './schemas/user.schema';
import { RequestWithUser } from '../auth/interfaces/request-with-user.interface';
import { UsersService } from './users.service';
import { AdminListUsersQueryDto } from './dto/admin-list-users-query.dto';
import { AdminUpdateUserDto } from './dto/admin-update-user.dto';
import { buildUserProfile } from './utils/user-profile';

/**
 * Convenience alias for clients that call GET /users/me (same shape as GET /auth/me).
 * The authenticated profile is also available at GET /auth/me.
 */
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  async getMe(@Req() req: RequestWithUser) {
    const user = await this.usersService.findOne(req.user.sub);
    return buildUserProfile(user);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminList(@Query() query: AdminListUsersQueryDto) {
    return this.usersService.adminFindMany(query);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminGetOne(@Param('id', ParseObjectIdPipe) id: Types.ObjectId) {
    return this.usersService.adminFindOne(id.toString());
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async adminPatch(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Body() dto: AdminUpdateUserDto,
    @CurrentUser() actor: { sub: string },
  ) {
    return this.usersService.adminUpdate(id.toString(), dto, actor.sub);
  }
}
