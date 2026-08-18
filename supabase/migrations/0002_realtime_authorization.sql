-- Realtime Authorization for ephemeral location broadcast + presence.
--
-- Each user owns exactly one private Realtime channel, topic
-- 'user-location:<their-own-user-id>'. They broadcast their live coordinates
-- and presence (online/broadcasting) on it; nothing here is written to a
-- table -- Realtime Broadcast is in-memory fan-out only, so there is no
-- location history to secure or leak.
--
-- These policies are what actually enforce "only mutual friends can see my
-- location" -- the client-side filter in the app is defense in depth, not
-- the primary control.
--
-- One caveat on the word "enforce", spelled out in 0006: Realtime evaluates
-- these when a channel is joined and caches the result for the life of the
-- connection. Revoking a friendship therefore takes effect on the next
-- authorization check, not on the next message.

-- A user may read broadcast/presence events on a 'user-location:*' topic if
-- it's their own channel, or if they have an accepted friendship with the
-- channel's owner.
create policy "realtime: read own or accepted friend's location channel"
  on realtime.messages for select
  to authenticated
  using (
    realtime.topic() like 'user-location:%'
    and (
      realtime.topic() = 'user-location:' || auth.uid()::text
      or exists (
        select 1
        from public.friendships f
        where f.status = 'accepted'
          and (
            (f.requester_id = auth.uid() and 'user-location:' || f.addressee_id::text = realtime.topic())
            or (f.addressee_id = auth.uid() and 'user-location:' || f.requester_id::text = realtime.topic())
          )
      )
    )
  );

-- A user may only publish (broadcast/track presence) on their own channel.
create policy "realtime: broadcast only to own location channel"
  on realtime.messages for insert
  to authenticated
  with check (
    realtime.topic() = 'user-location:' || auth.uid()::text
  );
