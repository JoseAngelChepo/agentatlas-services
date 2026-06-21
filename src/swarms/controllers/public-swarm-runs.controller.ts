import { Controller, Get, Param } from '@nestjs/common';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { AgentRunsService } from '../services/agent-runs.service';
import { AgentWorkersService } from '../services/agent-workers.service';
import { SwarmRunsService } from '../services/swarm-runs.service';
import { SwarmsService } from '../services/swarms.service';
import { serializePublicSwarmRunLogs } from '../utils/swarm-serializers';

/** Public demo/share links — no auth; only finished runs (`done` / `failed`). */
@Controller('public/swarm-runs')
export class PublicSwarmRunsController {
  constructor(
    private readonly swarmRunsService: SwarmRunsService,
    private readonly agentRunsService: AgentRunsService,
    private readonly swarmsService: SwarmsService,
    private readonly agentWorkersService: AgentWorkersService,
  ) {}

  @Get(':id')
  async getLogs(@Param('id', ParseObjectIdPipe) id: string) {
    const swarmRun = await this.swarmRunsService.findByIdForPublicView(id);
    const [agentRuns, swarm] = await Promise.all([
      this.agentRunsService.findBySwarmRun(swarmRun._id),
      this.swarmsService.findById(swarmRun.swarmId.toString()),
    ]);
    const workerIds = [...new Set(agentRuns.map((run) => run.workerId))];
    const workers = await this.agentWorkersService.findByIds(workerIds);

    return serializePublicSwarmRunLogs({ swarm, swarmRun, agentRuns, workers });
  }
}
