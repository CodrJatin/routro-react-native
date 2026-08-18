-- Realtime Authorization for meet requests.
--
-- A meet request ("come and meet me at Rajiv Chowk") is a private thing
-- between two people, so it deliberately does NOT ride on the location
-- channel: every accepted friend is subscribed to that one, and asking one
-- friend to meet would have been readable by all of them.
--
-- Instead each *pair* of accepted friends shares one topic,
-- 'meet:<idA>:<idB>', with the two user ids sorted so both sides compute the
-- same name (see meetTopicFor in src/realtime/meetMessage.ts). Both orderings
-- are accepted below rather than relying on least()/greatest(), so the policy
-- can never disagree with the client's sort over a collation detail.
--
-- Nothing here is written to a table either -- this is Realtime Broadcast,
-- in-memory fan-out only. A request lives 30 seconds and then it is gone.

-- Read: only the two people the topic is named after, and only while they are
-- actually friends.
--
-- "Only while they are actually friends" needs one qualification, because an
-- earlier version of this comment claimed unfriending closed the channel
-- immediately and that is not what Realtime does. Policies here are evaluated
-- when a channel is joined and cached for the life of the connection -- the
-- database is not consulted per message. A cached grant is only recalculated
-- when a new JWT reaches the server on the `access_token` message, and the
-- connection is dropped outright when the JWT expires with no replacement.
--
-- So for a client running this app, unfriending does take effect at once, but
-- the client is what makes that true: it learns of the deleted row through
-- postgres_changes and drops the channel itself (see `syncFriendSubscriptions`
-- in src/realtime/locationChannel.ts). A modified client that simply held its
-- socket open would keep receiving until its token was next refreshed, which
-- is bounded by the project's JWT expiry -- one hour by default. Shortening
-- that expiry is the only lever that narrows the window; nothing in this file
-- can.
--
-- Worth stating plainly rather than leaving the stronger claim in place: this
-- is a real limit on what "unfriend" guarantees against a hostile peer, and
-- the same applies to the location policies in 0002.
create policy "realtime: read meet channel shared with an accepted friend"
  on realtime.messages for select
  to authenticated
  using (
    realtime.topic() like 'meet:%'
    and exists (
      select 1
      from public.friendships f
      where f.status = 'accepted'
        and (f.requester_id = auth.uid() or f.addressee_id = auth.uid())
        and realtime.topic() in (
          'meet:' || f.requester_id::text || ':' || f.addressee_id::text,
          'meet:' || f.addressee_id::text || ':' || f.requester_id::text
        )
    )
  );

-- Write: the same test. A user can only publish into a channel they are one
-- half of, which is what stops anyone injecting a request that appears to come
-- from someone else.
create policy "realtime: publish to meet channel shared with an accepted friend"
  on realtime.messages for insert
  to authenticated
  with check (
    realtime.topic() like 'meet:%'
    and exists (
      select 1
      from public.friendships f
      where f.status = 'accepted'
        and (f.requester_id = auth.uid() or f.addressee_id = auth.uid())
        and realtime.topic() in (
          'meet:' || f.requester_id::text || ':' || f.addressee_id::text,
          'meet:' || f.addressee_id::text || ':' || f.requester_id::text
        )
    )
  );
