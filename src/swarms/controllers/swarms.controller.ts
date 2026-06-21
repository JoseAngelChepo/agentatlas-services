import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Types } from 'mongoose';
import { AllowUserPat } from '../../common/decorators/allow-user-pat.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtOrUserPatGuard } from '../../common/guards/jwt-or-user-pat.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserPatScopeGuard } from '../../common/guards/user-pat-scope.guard';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { UserRole } from '../../users/schemas/user.schema';
import { CreateSwarmDto } from '../dto/create-swarm.dto';
import { DuplicateSwarmDto } from '../dto/duplicate-swarm.dto';
import { RunSwarmDto } from '../dto/run-swarm.dto';
import { UpdateSwarmDto } from '../dto/update-swarm.dto';
import { UpsertSwarmGraphDto } from '../dto/upsert-swarm-graph.dto';
import { SwarmOrchestratorService } from '../orchestrator/swarm-orchestrator.service';
import { AgentWorkersService } from '../services/agent-workers.service';
import { SwarmAccessService } from '../services/swarm-access.service';
import { SwarmGraphsService } from '../services/swarm-graphs.service';
import { SwarmDuplicationService } from '../services/swarm-duplication.service';
import { SwarmRunsService } from '../services/swarm-runs.service';
import { SwarmsService } from '../services/swarms.service';
import {
  serializeAgentWorker,
  serializeSwarm,
  serializeSwarmGraph,
  serializeSwarmRun,
} from '../utils/swarm-serializers';
import {
  extractEndOutputKeys,
  extractStartInputNames,
} from '../utils/extract-swarm-io-contract';
import { collectReferencedSwarmIdsFromGraph } from '../utils/validate-swarm-graph-references';

@Controller('swarms')
@UseGuards(JwtOrUserPatGuard, UserPatScopeGuard, RolesGuard)
@Roles(UserRole.USER)
export class SwarmsController {
  constructor(
    private readonly swarmsService: SwarmsService,
    private readonly swarmDuplicationService: SwarmDuplicationService,
    private readonly swarmAccessService: SwarmAccessService,
    private readonly swarmGraphsService: SwarmGraphsService,
    private readonly swarmRunsService: SwarmRunsService,
    private readonly swarmOrchestrator: SwarmOrchestratorService,
    private readonly agentWorkersService: AgentWorkersService,
  ) {}

  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateSwarmDto) {
    const doc = await this.swarmsService.create(user.sub, dto);
    return serializeSwarm(doc);
  }

  @Post(':id/duplicate')
  async duplicate(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: DuplicateSwarmDto,
  ) {
    const result = await this.swarmDuplicationService.duplicateForUser(user.sub, id, dto);
    return {
      swarm: serializeSwarm(result.swarm),
      graph: result.graph ? serializeSwarmGraph(result.graph) : null,
    };
  }

  @Get()
  @AllowUserPat()
  async list(@CurrentUser() user: JwtPayload) {
    const docs = await this.swarmsService.findAllForUser(user.sub);
    return docs.map(serializeSwarm);
  }

  @Get(':id/workspace')
  @AllowUserPat()
  async getWorkspace(@CurrentUser() user: JwtPayload, @Param('id', ParseObjectIdPipe) id: string) {
    const swarm = await this.swarmsService.findByIdForUser(user.sub, id);

    let graph: ReturnType<typeof serializeSwarmGraph> | null = null;
    let graphDoc: Awaited<ReturnType<SwarmGraphsService['findBySwarmIdForUser']>> | null = null;
    try {
      graphDoc = await this.swarmGraphsService.findBySwarmIdForUser(user.sub, id);
      graph = serializeSwarmGraph(graphDoc);
    } catch (err) {
      if (!(err instanceof NotFoundException)) {
        throw err;
      }
    }

    const workerIdSet = new Set<string>(swarm.workers.map((w) => w.toString()));
    if (graph) {
      for (const node of graph.nodes) {
        if (node.workerId) {
          workerIdSet.add(node.workerId.toString());
        }
      }
      for (const terminalId of [graph.entryNode, graph.exitNode]) {
        if (Types.ObjectId.isValid(terminalId)) {
          workerIdSet.add(terminalId);
        }
      }
    }

    const workerDocs =
      workerIdSet.size > 0
        ? await this.agentWorkersService.findByIds(
            [...workerIdSet].map((workerId) => new Types.ObjectId(workerId)),
          )
        : new Map();

    const workers = [...workerDocs.values()]
      .filter((doc) => doc.createdBy.toString() === user.sub)
      .map(serializeAgentWorker);

    const referencedSwarmIds = graphDoc
      ? collectReferencedSwarmIdsFromGraph(graphDoc)
      : [];
    const referencedSwarmDocs =
      referencedSwarmIds.length > 0
        ? await this.swarmsService.findByIds(referencedSwarmIds)
        : new Map();
    const referencedGraphs =
      referencedSwarmIds.length > 0
        ? await this.swarmGraphsService.findManyBySwarmIds(referencedSwarmIds)
        : new Map();

    const referencedSwarms = await Promise.all(
      referencedSwarmIds.map(async (refId) => {
        const doc = referencedSwarmDocs.get(refId);
        if (!doc) {
          return null;
        }
        const refGraph = referencedGraphs.get(refId) ?? null;
        return {
          id: doc.id,
          name: doc.name,
          goal: doc.goal,
          active: doc.active ?? true,
          platformRunnable: doc.platformRunnable ?? false,
          canRun: await this.swarmAccessService.canRun(user.sub, refId),
          inputs: extractStartInputNames(refGraph),
          outputs: extractEndOutputKeys(refGraph),
        };
      }),
    );

    return {
      swarm: serializeSwarm(swarm),
      graph,
      workers,
      referencedSwarms: referencedSwarms.filter(
        (row): row is NonNullable<typeof row> => row != null,
      ),
    };
  }

  @Get(':id')
  @AllowUserPat()
  async getOne(@CurrentUser() user: JwtPayload, @Param('id', ParseObjectIdPipe) id: string) {
    const doc = await this.swarmsService.findByIdForUser(user.sub, id);
    return serializeSwarm(doc);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateSwarmDto,
  ) {
    const doc = await this.swarmsService.update(user.sub, id, dto);
    return serializeSwarm(doc);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: JwtPayload, @Param('id', ParseObjectIdPipe) id: string) {
    await this.swarmsService.remove(user.sub, id);
  }

  @Get(':id/graph')
  @AllowUserPat()
  async getGraph(@CurrentUser() user: JwtPayload, @Param('id', ParseObjectIdPipe) id: string) {
    const doc = await this.swarmGraphsService.findBySwarmIdForUser(user.sub, id);
    return serializeSwarmGraph(doc);
  }

  @Put(':id/graph')
  async upsertGraph(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpsertSwarmGraphDto,
  ) {
    const doc = await this.swarmGraphsService.upsertForUser(user.sub, id, dto);
    return serializeSwarmGraph(doc);
  }

  @Post(':id/run')
  @AllowUserPat()
  async run(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: RunSwarmDto,
  ) {
    await this.swarmAccessService.assertCanRun(user.sub, id);
    const result = await this.swarmOrchestrator.runSwarm(id, {
      userId: user.sub,
      role: user.role,
      input: dto.input,
      maxNodeVisits: dto.maxNodeVisits,
    });
    return {
      swarmRun: serializeSwarmRun(result.swarmRun),
      output: result.output,
      paused: result.paused,
      ...(result.approval ? { approval: result.approval } : {}),
    };
  }

  /** SSE stream for workspace test panel. Same body as `POST :id/run`. */
  @Post(':id/run/stream')
  @AllowUserPat()
  async runStream(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: RunSwarmDto,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    await this.swarmAccessService.assertCanRun(user.sub, id);
    await this.swarmOrchestrator.runSwarmStream(id, {
      userId: user.sub,
      role: user.role,
      input: dto.input,
      maxNodeVisits: dto.maxNodeVisits,
    }, res, { skipAccessCheck: true });
  }

  @Get(':id/runs')
  @AllowUserPat()
  async listRuns(@CurrentUser() user: JwtPayload, @Param('id', ParseObjectIdPipe) id: string) {
    const docs = await this.swarmRunsService.findAllForSwarm(user.sub, id);
    return docs.map(serializeSwarmRun);
  }
}
