import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AllowUserPat } from '../../common/decorators/allow-user-pat.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtOrUserPatGuard } from '../../common/guards/jwt-or-user-pat.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserPatScopeGuard } from '../../common/guards/user-pat-scope.guard';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { UserRole } from '../../users/schemas/user.schema';
import { AgentRunsService } from '../services/agent-runs.service';
import { SwarmRunApprovalsService } from '../services/swarm-run-approvals.service';
import { SwarmRunsService } from '../services/swarm-runs.service';
import { serializeSwarmRunApproval } from '../utils/swarm-run-approval-serializers';
import { serializeAgentRun, serializeSwarmRun } from '../utils/swarm-serializers';

@Controller('swarm-runs')
@UseGuards(JwtOrUserPatGuard, UserPatScopeGuard, RolesGuard)
@Roles(UserRole.USER)
@AllowUserPat()
export class SwarmRunsController {
  constructor(
    private readonly swarmRunsService: SwarmRunsService,
    private readonly agentRunsService: AgentRunsService,
    private readonly swarmRunApprovalsService: SwarmRunApprovalsService,
  ) {}

  @Get(':id')
  async getOne(@CurrentUser() user: JwtPayload, @Param('id', ParseObjectIdPipe) id: string) {
    const doc = await this.swarmRunsService.findByIdForUser(user.sub, id);
    return serializeSwarmRun(doc);
  }

  @Get(':id/pending-approval')
  async getPendingApproval(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    await this.swarmRunsService.findByIdForUser(user.sub, id);
    const doc = await this.swarmRunApprovalsService.findPendingBySwarmRun(id);
    return doc ? serializeSwarmRunApproval(doc) : null;
  }

  @Get(':id/agent-runs')
  async listAgentRuns(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    const docs = await this.agentRunsService.findBySwarmRunForUser(user.sub, id);
    return docs.map(serializeAgentRun);
  }
}
