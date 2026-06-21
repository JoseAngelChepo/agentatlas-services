import { Body, Controller, ForbiddenException, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AllowUserPat } from '../../common/decorators/allow-user-pat.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtOrUserPatGuard } from '../../common/guards/jwt-or-user-pat.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserPatScopeGuard } from '../../common/guards/user-pat-scope.guard';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { UserRole } from '../../users/schemas/user.schema';
import { DecideSwarmRunApprovalDto } from '../dto/decide-swarm-run-approval.dto';
import { SwarmOrchestratorService } from '../orchestrator/swarm-orchestrator.service';
import { SwarmRunApprovalsService } from '../services/swarm-run-approvals.service';
import { serializeSwarmRunApproval } from '../utils/swarm-run-approval-serializers';
import { serializeSwarmRun } from '../utils/swarm-serializers';

@Controller('swarm-run-approvals')
@UseGuards(JwtOrUserPatGuard, UserPatScopeGuard, RolesGuard)
@Roles(UserRole.USER)
export class SwarmRunApprovalsController {
  constructor(
    private readonly swarmRunApprovalsService: SwarmRunApprovalsService,
    private readonly swarmOrchestrator: SwarmOrchestratorService,
  ) {}

  /** Inbox: pending human gates assigned to the current user. */
  @Get('pending')
  @AllowUserPat()
  async listPending(@CurrentUser() user: JwtPayload) {
    const docs = await this.swarmRunApprovalsService.findPendingForAssignee(user.sub);
    return docs.map(serializeSwarmRunApproval);
  }

  @Get(':id')
  @AllowUserPat()
  async getOne(@CurrentUser() user: JwtPayload, @Param('id', ParseObjectIdPipe) id: string) {
    const doc = await this.swarmRunApprovalsService.findById(id);
    const isAssignee = doc.assigneeUserId.toString() === user.sub;
    const isRequester = doc.requestedBy.toString() === user.sub;
    if (!isAssignee && !isRequester) {
      throw new ForbiddenException('You do not have access to this approval');
    }
    return serializeSwarmRunApproval(doc);
  }

  /**
   * Approve or reject a paused swarm run and resume graph traversal on the matching branch.
   */
  @Post(':id/decide')
  @AllowUserPat()
  async decide(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: DecideSwarmRunApprovalDto,
  ) {
    const approval = await this.swarmRunApprovalsService.decide(
      user.sub,
      id,
      dto.decision,
      dto.comment,
    );
    const result = await this.swarmOrchestrator.resumeAfterApproval(id, user.sub);
    return {
      approval: serializeSwarmRunApproval(approval),
      swarmRun: serializeSwarmRun(result.swarmRun),
      output: result.output,
      paused: result.paused ?? false,
      ...(result.approval ? { nextApproval: result.approval } : {}),
    };
  }

  /**
   * Decide and resume with SSE (test panel) — same event schema as `POST /swarms/:id/run/stream`.
   */
  @Post(':id/decide/stream')
  @AllowUserPat()
  async decideStream(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: DecideSwarmRunApprovalDto,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    await this.swarmRunApprovalsService.decide(user.sub, id, dto.decision, dto.comment);
    await this.swarmOrchestrator.resumeAfterApprovalStream(id, user.sub, res);
  }
}
