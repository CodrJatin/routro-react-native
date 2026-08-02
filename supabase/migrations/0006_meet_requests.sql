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
-- actually friends. Unfriending therefore closes the channel immediately.
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
