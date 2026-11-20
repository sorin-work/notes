import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { AcceptInviteDto, InviteDto, MemberRoleDto } from './dto/member.dto';
import { InviteView, MembersService, MemberView } from './members.service';

/**
 * Who a notebook is shared with. Closed to API tokens, like the other routes
 * that change who can get at what: a script with a token should not be able
 * to hand a notebook to someone.
 */
@Controller('notebooks/:notebookId/members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  /** The owner and the members of a notebook, and for the owner the open invitations. */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Param('notebookId', ParseUUIDPipe) notebookId: string,
  ): Promise<{ owner: { name: string }; members: MemberView[]; invites: InviteView[] }> {
    return this.members.list(user.id, notebookId);
  }

  /** Invites an address to the notebook, to read it or to edit it. Owner only. */
  @Post('invites')
  invite(
    @CurrentUser() user: AuthUser,
    @Param('notebookId', ParseUUIDPipe) notebookId: string,
    @Body() dto: InviteDto,
  ): Promise<InviteView> {
    return this.members.invite(user.id, notebookId, dto.email, dto.role);
  }

  /** Withdraws an open invitation. Owner only. */
  @Delete('invites/:inviteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(
    @CurrentUser() user: AuthUser,
    @Param('notebookId', ParseUUIDPipe) notebookId: string,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
  ): Promise<void> {
    return this.members.revoke(user.id, notebookId, inviteId);
  }

  /** Changes what a member may do. Owner only. */
  @Patch(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  changeRole(
    @CurrentUser() user: AuthUser,
    @Param('notebookId', ParseUUIDPipe) notebookId: string,
    @Param('userId', ParseUUIDPipe) memberId: string,
    @Body() dto: MemberRoleDto,
  ): Promise<void> {
    return this.members.changeRole(user.id, notebookId, memberId, dto.role);
  }

  /** Takes a member out of the notebook: the owner removing someone, or a member leaving. */
  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('notebookId', ParseUUIDPipe) notebookId: string,
    @Param('userId', ParseUUIDPipe) memberId: string,
  ): Promise<void> {
    return this.members.remove(user.id, notebookId, memberId);
  }
}

/** Accepting an invitation, by the token of its link. */
@Controller('invites')
export class InvitesController {
  constructor(private readonly members: MembersService) {}

  /** Accepts an invitation by the token of its link. The account presenting it joins. */
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  acceptByToken(@CurrentUser() user: AuthUser, @Body() dto: AcceptInviteDto): Promise<{ notebookId: string }> {
    return this.members.acceptByToken(user.id, dto.token);
  }
}
