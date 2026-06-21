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
  Res,
  UseGuards,
} from '@nestjs/common';
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
import { CreateAgentWorkerDto } from '../dto/create-agent-worker.dto';
import { RunAgentWorkerDto } from '../dto/run-agent-worker.dto';
import { UpdateAgentWorkerDto } from '../dto/update-agent-worker.dto';
import { SwarmOrchestratorService } from '../orchestrator/swarm-orchestrator.service';
import { AgentWorkersService } from '../services/agent-workers.service';
import { serializeAgentWorker, serializeSwarmRun } from '../utils/swarm-serializers';

@Controller('agent-workers')
@UseGuards(JwtOrUserPatGuard, UserPatScopeGuard, RolesGuard)
@Roles(UserRole.USER)
export class AgentWorkersController {
  constructor(
    private readonly agentWorkersService: AgentWorkersService,
    private readonly swarmOrchestrator: SwarmOrchestratorService,
  ) {}

  @Post()
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateAgentWorkerDto) {
    const doc = await this.agentWorkersService.create(user.sub, dto);
    return serializeAgentWorker(doc);
  }

  @Get()
  @AllowUserPat()
  async list(@CurrentUser() user: JwtPayload) {
    const docs = await this.agentWorkersService.findAllForUser(user.sub);
    return docs.map(serializeAgentWorker);
  }

  @Post(':id/run')
  @AllowUserPat()
  async runPreview(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: RunAgentWorkerDto,
  ) {
    const result = await this.swarmOrchestrator.runWorkerPreview({
      userId: user.sub,
      role: user.role,
      swarmId: dto.swarmId,
      workerId: id,
      input: dto.input,
      upstream: dto.upstream,
    });
    return {
      swarmRun: serializeSwarmRun(result.swarmRun),
      output: result.output,
      agentRunId: result.agentRunId,
    };
  }

  @Post(':id/run/stream')
  @AllowUserPat()
  async runPreviewStream(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: RunAgentWorkerDto,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    await this.swarmOrchestrator.runWorkerPreviewStream(
      {
        userId: user.sub,
        role: user.role,
        swarmId: dto.swarmId,
        workerId: id,
        input: dto.input,
        upstream: dto.upstream,
      },
      res,
    );
  }

  @Get(':id')
  @AllowUserPat()
  async getOne(@CurrentUser() user: JwtPayload, @Param('id', ParseObjectIdPipe) id: string) {
    const doc = await this.agentWorkersService.findByIdForUser(user.sub, id);
    return serializeAgentWorker(doc);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateAgentWorkerDto,
  ) {
    const doc = await this.agentWorkersService.update(user.sub, id, dto);
    return serializeAgentWorker(doc);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: JwtPayload, @Param('id', ParseObjectIdPipe) id: string) {
    await this.agentWorkersService.remove(user.sub, id);
  }
}
