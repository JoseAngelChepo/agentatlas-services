import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { UserRole } from '../../users/schemas/user.schema';
import { AgentRunsService } from '../services/agent-runs.service';
import { SwarmRunsService } from '../services/swarm-runs.service';
import { serializeAgentRun, serializeSwarmRun } from '../utils/swarm-serializers';

@Controller('admin/swarm-runs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminSwarmRunsController {
  constructor(
    private readonly swarmRunsService: SwarmRunsService,
    private readonly agentRunsService: AgentRunsService,
  ) {}

  @Get(':id')
  async getOne(@Param('id', ParseObjectIdPipe) id: string) {
    const doc = await this.swarmRunsService.findById(id);
    return serializeSwarmRun(doc);
  }

  @Get(':id/agent-runs')
  async listAgentRuns(@Param('id', ParseObjectIdPipe) id: string) {
    const docs = await this.agentRunsService.findBySwarmRunAdmin(id);
    return docs.map(serializeAgentRun);
  }
}
