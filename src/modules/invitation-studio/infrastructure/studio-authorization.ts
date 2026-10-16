import { AuthenticationRequiredError } from '../../identity-access/authorization/authenticated-actor.middleware.js';
import { AppError, NotFoundError } from '../../../core/errors/app-error.js';
import type { createInvitationEditorReader } from '../../identity-access/authorization/invitation-editor.reader.js';
import type { MediaAccessGuard, MediaRequestContext } from '../application/media.contracts.js';
import { contractContext } from './studio.repository.js';

export class StudioAuthorization {
  constructor(
    readonly guard: MediaAccessGuard,
    readonly editor: ReturnType<typeof createInvitationEditorReader>,
    readonly denied?: (bookingId: string, context: MediaRequestContext) => Promise<void>,
    readonly templateDenied?: (context: MediaRequestContext) => Promise<void>,
  ) {}
  async booking(bookingId: string, context: MediaRequestContext, role?: 'COUPLE' | 'MANAGER') {
    try {
      const actor = await this.guard.requireAccess(bookingId, context);
      if (role !== undefined && actor.role !== role) throw new NotFoundError();
    } catch (error) {
      if (error instanceof AppError && [401, 403, 404].includes(error.status))
        await this.denied?.(bookingId, context);
      throw error;
    }
  }
  async manager(context: MediaRequestContext) {
    try {
      const actor = await this.authority(context);
      if (!actor.roles.includes('MANAGER')) throw new NotFoundError();
    } catch (error) {
      await this.recordTemplateDenial(error, context);
      throw error;
    }
  }
  async templates(
    bookingId: string | undefined,
    includeArchived: boolean,
    context: MediaRequestContext,
  ) {
    try {
      const actor = await this.authority(context);
      if (!actor.roles.includes('MANAGER')) {
        if (!actor.roles.includes('COUPLE') || bookingId === undefined || includeArchived)
          throw new NotFoundError();
        const bookingActor = await this.guard.requireAccess(bookingId, context);
        if (bookingActor.role !== 'COUPLE') throw new NotFoundError();
      }
    } catch (error) {
      await this.recordTemplateDenial(error, context);
      throw error;
    }
  }
  private async recordTemplateDenial(error: unknown, context: MediaRequestContext) {
    if (error instanceof AppError && [401, 403, 404].includes(error.status))
      await this.templateDenied?.(context);
  }
  async actor(context: MediaRequestContext) {
    if (context.accessToken === undefined) throw new AuthenticationRequiredError();
    const actor = await this.editor.resolve(
      context.accessToken,
      context.transactionScopeId === undefined ? undefined : contractContext(context),
    );
    if (actor.accountId !== context.actorId) throw new AuthenticationRequiredError();
    return actor;
  }
  private async authority(context: MediaRequestContext) {
    if (context.accessToken === undefined) throw new AuthenticationRequiredError();
    const actor = await this.editor.resolveAuthority(
      context.accessToken,
      context.transactionScopeId === undefined ? undefined : contractContext(context),
    );
    if (actor.accountId !== context.actorId) throw new AuthenticationRequiredError();
    return actor;
  }
}
