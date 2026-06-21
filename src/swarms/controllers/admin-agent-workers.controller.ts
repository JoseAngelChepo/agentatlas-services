import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { UserRole } from '../../users/schemas/user.schema';
import { AdminListAgentWorkersQueryDto } from '../dto/admin-list-agent-workers-query.dto';
import { UpdateAgentWorkerDto } from '../dto/update-agent-worker.dto';
import { AgentWorkersService } from '../services/agent-workers.service';
import { serializeAgentWorker } from '../utils/swarm-serializers';

@Controller('admin/agent-workers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminAgentWorkersController {
  constructor(private readonly agentWorkersService: AgentWorkersService) {}

  @Get()
  async list(@Query() query: AdminListAgentWorkersQueryDto) {
    const result = await this.agentWorkersService.adminFindMany(query);
    return {
      ...result,
      items: result.items.map(serializeAgentWorker),
    };
  }

  @Get(':id')
  async getOne(@Param('id', ParseObjectIdPipe) id: string) {
    const doc = await this.agentWorkersService.adminFindOne(id);
    return serializeAgentWorker(doc);
  }

  @Patch(':id')
  async update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateAgentWorkerDto) {
    const doc = await this.agentWorkersService.adminUpdate(id, dto);
    return serializeAgentWorker(doc);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseObjectIdPipe) id: string) {
    await this.agentWorkersService.adminRemove(id);
  }
}
