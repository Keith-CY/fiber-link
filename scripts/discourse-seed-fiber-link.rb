# frozen_string_literal: true

require "json"

def env_fetch_or_default(name, fallback)
  value = ENV[name]
  return fallback if value.nil? || value.strip.empty?
  value.strip
end

def ensure_user(username:, email:, password:)
  user = User.find_by(username: username) || User.new(username: username)
  user.name = username if user.name.blank?
  user.email = email
  password_matches =
    user.persisted? && user.respond_to?(:confirm_password?) && user.confirm_password?(password)
  user.password = password unless password_matches
  user.active = true if user.respond_to?(:active=)
  user.approved = true if user.respond_to?(:approved=)
  user.save!
  user.activate if user.respond_to?(:activate)
  if user.respond_to?(:approved=) && !user.approved?
    user.approved = true
    user.save!
  end
  user
end

def ensure_topic(owner:, title:, raw:)
  topic = Topic.find_by(title: title)
  return topic if topic

  first_post = PostCreator.create!(owner, title: title, raw: raw)
  first_post.topic
end

def ensure_reply(author:, topic:, raw:)
  existing = topic.posts.where(user_id: author.id).where("post_number > 1").order(:id).last
  return existing if existing

  PostCreator.create!(author, topic_id: topic.id, raw: raw)
end

tipper_username = env_fetch_or_default("FLOW_TIPPER_USERNAME", "fiber_tipper")
tipper_email = env_fetch_or_default("FLOW_TIPPER_EMAIL", "fiber_tipper@example.test")
tipper_password = env_fetch_or_default("FLOW_TIPPER_PASSWORD", "fiber-local-pass-1")

author_username = env_fetch_or_default("FLOW_AUTHOR_USERNAME", "fiber_author")
author_email = env_fetch_or_default("FLOW_AUTHOR_EMAIL", "fiber_author@example.test")
author_password = env_fetch_or_default("FLOW_AUTHOR_PASSWORD", "fiber-local-pass-1")

topic_title = env_fetch_or_default("FLOW_TOPIC_TITLE", "Fiber Link Local Workflow Topic")
topic_raw = env_fetch_or_default("FLOW_TOPIC_RAW", "This topic is created by local workflow automation.")
reply_raw = env_fetch_or_default("FLOW_REPLY_RAW", "This reply is created by local workflow automation.")

service_url = env_fetch_or_default("FIBER_LINK_DISCOURSE_SERVICE_URL", "http://host.docker.internal:3000")
app_id = env_fetch_or_default("FIBER_LINK_APP_ID", "local-dev")
app_secret = env_fetch_or_default("FIBER_LINK_APP_SECRET", "")
raise "FIBER_LINK_APP_SECRET must be provided" if app_secret.empty?

if SiteSetting.respond_to?(:allow_uncategorized_topics=)
  SiteSetting.allow_uncategorized_topics = true
end
if SiteSetting.respond_to?(:max_logins_per_ip_per_hour=)
  SiteSetting.max_logins_per_ip_per_hour = 10_000
end
if SiteSetting.respond_to?(:max_logins_per_ip_per_minute=)
  SiteSetting.max_logins_per_ip_per_minute = 10_000
end

tipper = ensure_user(username: tipper_username, email: tipper_email, password: tipper_password)
author = ensure_user(username: author_username, email: author_email, password: author_password)

if tipper.respond_to?(:admin=) && !tipper.admin?
  tipper.admin = true
  tipper.save!
end

topic = ensure_topic(owner: tipper, title: topic_title, raw: topic_raw)
first_post = topic.first_post
reply = ensure_reply(author: author, topic: topic, raw: reply_raw)

SiteSetting.fiber_link_enabled = true
SiteSetting.fiber_link_service_url = service_url
SiteSetting.fiber_link_app_id = app_id
SiteSetting.fiber_link_app_secret = app_secret

puts JSON.generate(
  {
    tipper: {
      id: tipper.id.to_s,
      username: tipper.username,
    },
    author: {
      id: author.id.to_s,
      username: author.username,
    },
    topic: {
      id: topic.id.to_s,
      title: topic.title,
      first_post_id: first_post.id.to_s,
    },
    reply: {
      post_id: reply.id.to_s,
    },
    plugin_settings: {
      fiber_link_enabled: SiteSetting.fiber_link_enabled,
      fiber_link_service_url: SiteSetting.fiber_link_service_url,
      fiber_link_app_id: SiteSetting.fiber_link_app_id,
    },
  },
)
