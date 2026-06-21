import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { UserRole } from '../../users/schemas/user.schema';
import { AdminListSwarmsQueryDto } from '../dto/admin-list-swarms-query.dto';
import { DecideSwarmRunApprovalDto } from '../dto/decide-swarm-run-approval.dto';
import { RunSwarmDto } from '../dto/run-swarm.dto';
import { UpdateSwarmDto } from '../dto/update-swarm.dto';
import { UpsertSwarmGraphDto } from '../dto/upsert-swarm-graph.dto';
import { SwarmOrchestratorService } from '../orchestrator/swarm-orchestrator.service';
import { SwarmGraphsService } from '../services/swarm-graphs.service';
import { SwarmRunApprovalsService } from '../services/swarm-run-approvals.service';
import { SwarmRunsService } from '../services/swarm-runs.service';
import { SwarmsService } from '../services/swarms.service';
import { serializeSwarmRunApproval } from '../utils/swarm-run-approval-serializers';
import {
  serializeSwarm,
  serializeSwarmGraph,
  serializeSwarmRun,
} from '../utils/swarm-serializers';

@Controller('admin/swarms')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminSwarmsController {
  constructor(
    private readonly swarmsService: SwarmsService,
    private readonly swarmGraphsService: SwarmGraphsService,
    private readonly swarmRunsService: SwarmRunsService,
    private readonly swarmOrchestrator: SwarmOrchestratorService,
    private readonly swarmRunApprovalsService: SwarmRunApprovalsService,
  ) {}

  @Get()
  async list(@Query() query: AdminListSwarmsQueryDto) {
    const result = await this.swarmsService.adminFindMany(query);
    return {
      ...result,
      items: result.items.map(serializeSwarm),
    };
  }

  @Get(':id/runs')
  async listRuns(@Param('id', ParseObjectIdPipe) id: string) {
    const docs = await this.swarmRunsService.findAllForSwarmAdmin(id);
    return docs.map(serializeSwarmRun);
  }

  @Get(':id/graph')
  async getGraph(@Param('id', ParseObjectIdPipe) id: string) {
    const doc = await this.swarmGraphsService.adminFindBySwarmId(id);
    return serializeSwarmGraph(doc);
  }

  @Get(':id')
  async getOne(@Param('id', ParseObjectIdPipe) id: string) {
    const doc = await this.swarmsService.adminFindOne(id);
    return serializeSwarm(doc);
  }

  @Patch(':id')
  async update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateSwarmDto) {
    const doc = await this.swarmsService.adminUpdate(id, dto);
    return serializeSwarm(doc);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseObjectIdPipe) id: string) {
    await this.swarmsService.adminRemove(id);
  }

  @Put(':id/graph')
  async upsertGraph(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpsertSwarmGraphDto,
  ) {
    const doc = await this.swarmGraphsService.adminUpsert(id, dto, user.sub);
    return serializeSwarmGraph(doc);
  }

  @Post(':id/run')
  async run(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: RunSwarmDto,
  ) {
    await this.swarmsService.adminFindOne(id);
    const result = await this.swarmOrchestrator.runSwarm(id, {
      userId: user.sub,
      role: user.role,
      input: dto.input,
      maxNodeVisits: dto.maxNodeVisits,
    });
    return {
      swarmRun: serializeSwarmRun(result.swarmRun),
      output: result.output,
    };
  }

  /** Sync decide + resume for admin test panel fallback when SSE is unavailable. */
  @Post('swarm-run-approvals/:approvalId/decide')
  async decideApproval(
    @CurrentUser() user: JwtPayload,
    @Param('approvalId', ParseObjectIdPipe) approvalId: string,
    @Body() dto: DecideSwarmRunApprovalDto,
  ) {
    const approval = await this.swarmRunApprovalsService.decide(
      user.sub,
      approvalId,
      dto.decision,
      dto.comment,
    );
    const result = await this.swarmOrchestrator.resumeAfterApproval(approvalId, user.sub, {
      skipAccessCheck: true,
    });
    return {
      approval: serializeSwarmRunApproval(approval),
      swarmRun: serializeSwarmRun(result.swarmRun),
      output: result.output,
      paused: result.paused ?? false,
      ...(result.approval ? { nextApproval: result.approval } : {}),
    };
  }

  /**
   * Decide + resume with SSE for the admin test panel (mirrors `POST /swarm-run-approvals/:id/decide/stream`).
   */
  @Post('swarm-run-approvals/:approvalId/decide/stream')
  async decideApprovalStream(
    @CurrentUser() user: JwtPayload,
    @Param('approvalId', ParseObjectIdPipe) approvalId: string,
    @Body() dto: DecideSwarmRunApprovalDto,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    await this.swarmRunApprovalsService.decide(
      user.sub,
      approvalId,
      dto.decision,
      dto.comment,
    );
    await this.swarmOrchestrator.resumeAfterApprovalStream(approvalId, user.sub, res, {
      skipAccessCheck: true,
    });
  }

  /** SSE stream for admin swarm test panel (same events as user `POST /swarms/:id/run/stream`). */
  @Post(':id/run/stream')
  async runStream(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: RunSwarmDto,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    await this.swarmsService.adminFindOne(id);
    await this.swarmOrchestrator.runSwarmStream(
      id,
      {
        userId: user.sub,
        role: user.role,
        input: dto.input,
        maxNodeVisits: dto.maxNodeVisits,
      },
      res,
      { skipAccessCheck: true },
    );
  }
}
