---
title: "Building a gRPC rate limiter"
publishedAt: 2023-12-18
description: "An external rate limiting API built using Go which can serve multiple client at once using redis and postgresql"
slug: "fluxy-rate-limiter"
isPublish: true
---

## What is API rate limiting?

API rate limiting is a strategy used by web services to control the number of requests a client can make to an API within a certain time frame. The primary purpose of rate limiting is to protect the server from being overwhelmed by too many requests, which can lead to degraded performance or even downtime. By setting limits on how frequently a client can make requests or how many requests they can make in a given period, rate limiting helps maintain stability and reliability for all users of the API.

## Why choose gRPC?

gRPC stands out as an excellent choice for a rate limiting service when compared to traditional REST APIs, particularly when serving as a middleware for several reasons, but the standout advantage lies in its superior performance and lower latency. A couple of reasons are discussed below:

### Binary Protobuf Serialization

gRPC uses Protocol Buffers (Protobuf) for serialization, which offers a binary format, making it more compact and efficient compared to JSON used in REST APIs. This reduces data size during communication, resulting in faster transmission of messages, crucial for a middleware service that needs to minimize RTT.

### HTTP/2 and Multiplexing

gRPC utilizes HTTP/2, which supports multiplexing multiple requests over a single TCP connection. This significantly reduces overhead and minimizes latency by avoiding the need to create multiple connections for simultaneous requests.

## Defining requirements for our service

> I'll be calling this service _fluxy_ since flux means "a continuous movement" and we are dealing with controlling this movement

### 1. Interface for easily implementing any rate limiting algorithm

### 2. Update client limits on the fly with persistent rate limit configuration

### 3. Implement proper metrics and logging

### 4. Provide a helm chart for easy kubernetes deployment

## Code structure

We will be following Uncle Bob's, a software design principle that advocates for separating the different concerns within an application into distinct layers. By following Clean Architecture principles, we can ensure that our code is maintainable, scalable, and testable. (Learn more about Clean Architecture: https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)

Let's look at the project structure:

```bash[class="line-numbers"]
# Directory structure for fluxy
├── Dockerfile
├── Makefile
├── README.md
├── config
│   ├── config.go
│   ├── db.go
│   └── server.go
├── db
│   ├── db.go
│   ├── migrate.go
│   └── redis.go
├── docker-compose.yml
├── go.mod
├── logger
│   └── zerolog.go
├── main.go
├── models
│   └── client_model.go
├── pkg
│   └── v1
│       ├── algorithms
│       │   ├── algorithm.go
│       │   ├── fixed_window.go
│       │   └── rolling_window.go
│       ├── handlers
│       │   └── grpc
│       │       └── raterlimiter_service.go
│       ├── interfaces.go
│       ├── repository
│       │   └── ratelimiter.go
│       └── usecase
│           └── ratelimiter.go
└── proto
    └── ratelimiter.proto
```

Let us go over how this structure came to be and what all these pacakges do.

You can view the entire source code for fluxy here - [thegeekywanderer/fluxy]

## Writing the Protocol Buffer

The first step to writing a gRPC service is always defining a blueprint for your service. In a way, a proto file used in gRPC is similar to a REST API specification. After defining what we expect out of the service we can start writing out the business logic that will drive these APIs

```protobuf[class="line-numbers"]
// ratelimiter.proto
syntax = "proto3";
option go_package = "./proto";

service RateLimiterService {
  rpc RegisterClient(ClientRequest) returns (ClientResponse);
  rpc GetClient(SingleClientRequest) returns (ClientResponse);
  rpc UpdateClient(ClientRequest) returns (SuccessResponse);
  rpc DeleteClient(SingleClientRequest) returns (SuccessResponse);
  rpc VerifyLimit(SingleClientRequest) returns (StateResponse);
}

message SingleClientRequest{
  string name = 1;
}

message SuccessResponse{
  string response = 1;
}

message StateResponse{
  bool allowed = 1;
  int64 total_requests = 2;
  int64 expires_at = 3;
}

message ClientRequest{
  string name = 1;
  int64 limit = 2;
  int64 duration = 3;
}

message ClientResponse{
  string id = 1;
  string name = 2;
  int64 limit = 3;
  int64 duration = 4;
}
```

### RegisterClient

This function will be responsible for registering a new client into fluxy with their custom rate limits as specified in the _ClientRequest_. It should also ensure caching of the client limits to minimize database lookups.

### GetClient

This function will fetch an existing client details from our database based on the unique name of the client.

### UpdateClient

An already registered client limits can be updated on the fly using this function. It will also ensure that cache is updated so that ongoing rate limit requests can use the updated limits for a client.

### DeleteClient

This will remove the client from our database and will no longer rate limited.

### VerifyLimit

This is where the rate limiting magic happens. The handler verifies if the application is conforming to the rate limits that it was registered with or not. It can use any rate limiting algorithm that implements the fluxy Strategy interface hence making it extremely easy to implement and try out new algorithms. It will return a _StateResponse_ which has a `allowed` field which tells the caller if their API is hitting the limit or not.

Now lets generate the stubs for this protocol buffer using the following command. (Assuming _protoc_ is [installed])

[installed]: "https://grpc.io/docs/protoc-installation/"

```bash
protoc --go_out=. --go-grpc_out=. proto/ratelimiter.proto
```

## Defining the Client model

We will be using _gorm_ to manage our database queries. Here we define a very simple model for storing our client limits in our postgresql database:

```go[class="line-numbers"]
// client_model.go
package models

import "gorm.io/gorm"

type Client struct{
  gorm.Model

  Name     string  `gorm:"unique;not null"`
  Limit    uint64  `gorm:"not null"`
  Duration uint64  `gorm:"not null"`
}
```

The limit and duration together correspond to how many requests the client can handle in given seconds.

Now, let's write a simple migrate function to automigrate our model:

```go[class="line-numbers"]
// migrate.go
package database

import "github.com/thegeekywanderer/fluxy/models"

func Migrate(db *DB) {
	var migrationModels = []interface{}{&models.Client{}}
	err := db.Database.AutoMigrate(migrationModels...)
	if err != nil {
		return
	}
}
```

## Interface definitions

Now that we are setup with our model we will start writing the interfaces for our _repository_, _usecase_ and _algorithms_

### Repository

This contains the implementation of data access methods for fluxy. The interface looks as follows:

```go[class="line-numbers"]
// interfaces.go
type RepoInterface interface{
  RegisterClient(models.Client) (models.Client, error)
  GetClient(name string) (models.Client, error)
  UpdateClient(models.Client) (error)
  DeleteClient(name string) (error)
}
```

### Usecase

This contains the business logic of the application that runs fluxy. The interface looks as follows:

```go[class="line-numbers"]
// interfaces.go
type UseCaseInterface interface{
  RegisterClient(models.Client) (models.Client, error)
  GetClient(name string) (models.Client, error)
  UpdateClient(models.Client) (error)
  DeleteClient(name string) (error)
  VerifyLimit(name string) (*Result, error)
}
```

### Algorithms

This contains various rate limiting algorithms which can be used by fluxy. All they need to do is implement the _Strategy_ interface. Following are the structs and interface defined for algorithms:

```go[class="line-numbers"]
// interfaces.go
type State int64
const (
	Deny  State = 0
	Allow       = 1
)

type Request struct {
	Key      string
	Limit    uint64
	Duration time.Duration
}

type Result struct {
	State         State
	TotalRequests uint64
	ExpiresAt     time.Time
}

type Strategy interface {
	Run(r *Request) (*Result, error)
}
```

## Implementing the interfaces

I will not be going over implementation of all the methods to keep this article short. The entire source code can be viewed here - [thegeekywanderer/fluxy]

### Repository implementation

We'll have a look at how client limits are updated which will give an overview of how the other interfaces are implemented

```go[class="line-numbers"][data-line="12-14"]
// ratelimiter.go
package repository

func (repo *Repo) UpdateClient(client models.Client) error{
  var dbClient models.Client
  if err := repo.db.Where("name = ?", client.Name).First(&dbClient).Error;
    err != nil {
    return err
  }
  dbClient.Limit = client.Limit
  dbClient.Duration = client.Duration
  err := repo.db.Save(dbClient).Error
  json, err := json.Marshal(client)
  dataKey := fmt.Sprintf("%s-data", client.Name)
  err = repo.cache.Set(dataKey, json, 0).Err()
  if err != nil {
    return err
  }
  return err
}
```

It can be seen in the highlighted line that we are updating the redis cache with the client data so that when we are verifying rate limits we don't need to look up the client in the database. This would also mean that client limits are updated on the fly for the rate limiting logic since it would always look at the cache for the limits.

### UseCase implementation

For usecase CRUD functions are pretty straightforward since they will be using the repository implementations with minimal logic of their own. Let's look at the interesting one - _VerifyLimit_

```go[class="line-numbers"]
// ratelimiter.go
package usecase

func (uc *UseCase) VerifyLimit(name string) (*interfaces.Result, error) {
  strategy, err := algorithm.New(uc.algorithm, uc.cache, time.Now)
  if err != nil {
    log.Fatal(err)
  }
  dataKey := fmt.Sprintf("%s-data", name)
  val, err := uc.cache.Get(dataKey).Result()
  var client models.Client
  request := interfaces.Request{}
  if err != nil {
    client, err = uc.repo.GetClient(name)
    if err != nil {
      return nil, err
    }
    request.Key = client.Name
    request.Limit = client.Limit
    request.Duration = time.Duration(client.Duration) * time.Second
    json, err := json.Marshal(client)
    dataKey := fmt.Sprintf("%s-data", client.Name)
    err = uc.cache.Set(dataKey, json, 0).Err()
    if err != nil {
      return nil, err
    }
	}

  err = json.Unmarshal([]byte(val), &client)
  if err != nil {
    return nil, err
  }
  request.Key = client.Name
  request.Limit = client.Limit
  request.Duration = time.Duration(client.Duration) * time.Second

  res, err := strategy.Run(&request)
  if err != nil {
    return nil, err
  }
  return res, nil
}
```

In this function we are first getting the strategy from the algorithms package which can mean any algorithm and it doesn't concern this function. Then we check if the client details are in the cache or not. If not found in the cache for some reason, then we lookup the database and store it in cache for the next time.

Finally we run the _Run_ function defined on the _Strategy_ interface with the constructed request that specifies the client identity and their limits.

### Algorithm Implementation

We'll be looking at an extremely simple algorithm for rate limiting here to keep this article brief but there are more algorithms implemented in the repository. Let us look at the fixed window rate limiting algorithm:

```go[class="line-numbers"]
// fixed_window.go
package algorithm

const (
	keyWithoutExpire = -1
)

type FixedWindow struct{
	client 	*redis.Client
	now 	func() time.Time
}

// This approach uses a simple counter with an expiration set to the rate limit duration
// It is not very effective if you have to deal with bursty traffic
// as it will still allow a client to burn through its full limit quickly once the key expires.
func (fw *FixedWindow) Run(req *interfaces.Request) (*interfaces.Result, error) {
	p := fw.client.Pipeline()
	incrResult := p.Incr(req.Key)
	ttlResult := p.TTL( req.Key)
	if _, err := p.Exec(); err != nil {
		return nil, fmt.Errorf("failed to execute increment to key %v", req.Key)
	}
	totalRequests, err := incrResult.Result()
	if err != nil {
		return nil, fmt.Errorf("failed to increment key %v", req.Key)
	}

	var ttlDuration time.Duration
	if d, err := ttlResult.Result(); err != nil || d.Seconds() == keyWithoutExpire {
		ttlDuration = req.Duration
		if err := fw.client.Expire(req.Key, req.Duration).Err(); err != nil {
			return nil, fmt.Errorf("failed to set an expiration to key %v", req.Key)
		}
	} else {
		ttlDuration = d
	}

	expiresAt := fw.now().Add(ttlDuration)

	requests := uint64(totalRequests)

	if requests > req.Limit {
		return &interfaces.Result{
			State:         interfaces.Deny,
			TotalRequests: requests,
			ExpiresAt:     expiresAt,
		}, nil
	}

	return &interfaces.Result{
		State:         interfaces.Allow,
		TotalRequests: requests,
		ExpiresAt:     expiresAt,
	}, nil
}
```

This implementation is the _fixed window strategy_. It means that once the expiration has been set, a client that reaches the limit will be blocked from making further requests until the expiration time arrives. If a client has a limit of 50 requests every minute and makes all 50 requests in the first 5 seconds of the minute, it will have to wait 55 seconds to make another request. This is also the main downside of this implementation, it would still let a client burn through its whole limit quickly (bursty traffic) and that could still overload your service, as it could be expecting this traffic to be spread out throughout the whole limiting period.

And then adding this to our algorithm constructor we have something like this:

```go[class="line-numbers"]
// algorithms.go
package algorithm

func New(algorithm string, client *redis.Client, now func() time.Time) (interfaces.Strategy, error) {
	if algorithm == "fixed-window" {
		return &FixedWindow{
			client: client,
			now:    now,
		}, nil
	} else if algorithm == "rolling-window" {
		return &RollingWindow{
			client: client,
			now: 	now,
		}, nil
	}
	return nil, errors.New("Algorithm not implemented")
}
```

That's it, we can implement any algorithm into fluxy as simply as that.

> I'll not be going over how rest of the gRPC service is defined since that would not concern rate limiting but rather how we communicate with database and how we define the gRPC server. You can have a look at the entire source code here - [thegeekywanderer/fluxy]

## Deploying to Kubernetes

Let's look at a high level overview of how our kubernetes deployment would look:
![alt text](/posts/fluxy/cluster.svg)

We need to define a _deployment_, _service_, _configmap_ and a _secret_ for our application. Let's start by first defining our chart and dependencies:

```yaml[class="line-numbers"]
# Chart.yaml
apiVersion: v2
name: fluxy
description: A Helm chart for deploying fluxy to kubernetes

type: application
version: 0.1.0
appVersion: "1.16.0"

dependencies:
    - name: redis
      version: 18.5.0
      repository: https://charts.bitnami.com/bitnami
    - name: postgresql
      version: 13.2.24
      repository: https://charts.bitnami.com/bitnami
```

Run the following command to fetch the depenencies:

```bash
helm dependency update chart/
```

Now we will define our kubernetes deployment that will basically be running our application pods.

```yaml[class="line-numbers"]
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: fluxy-deployment
  labels:
    app: fluxy
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      app: fluxy
  template:
    metadata:
      labels:
        app: fluxy
    spec:
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - containerPort: {{ .Values.server.port }}
          envFrom:
            - configMapRef:
                name: fluxy-cm
            - secretRef:
                name: fluxy-secret
```

Next comes the service which will act as a gateway to our deployment

```yaml[class="line-numbers"]
# service.yaml
apiVersion: v1
kind: Service
metadata:
  name: fluxy-svc
  labels:
    app: fluxy
spec:
  type: {{ .Values.service.type }}
  ports:
    - port: {{ .Values.service.port }}
      targetPort: {{ .Values.service.targetPort }}
      protocol: TCP
  selector:
    app: fluxy
```

To inject the environment variables into our pods and to secure certain secret env variables we will be using kubernetes config-maps and secrets. Following are the configs for both:

```yaml[class="line-numbers"]
# configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: fluxy-cm
  labels:
    app: fluxy
data:
  ALGORITHM: {{ .Values.server.algorithm }}
  DEBUG: "{{ .Values.server.debug }}"
  SERVER_HOST: {{ .Values.server.host }}
  SERVER_PORT: "{{ .Values.server.port }}"
```

```yaml[class="line-numbers"]
# secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: fluxy-secret
  labels:
    app: fluxy
type: Opaque
data:
    DB_NAME: {{ .Values.postgresql.auth.database | b64enc | quote }}
    DB_USER: {{ .Values.postgresql.auth.username | b64enc | quote }}
    DB_PASSWORD: {{ .Values.postgresql.auth.password | b64enc | quote }}
    DB_HOST: {{ "fluxy-postgresql" | b64enc | quote }}
    DB_PORT: {{ "5432" | b64enc }}
    DB_LOG_MODE: {{ "True" | b64enc }}
    SSL_MODE: {{ "disable" | b64enc | quote }}

    REDIS_HOST: {{ "fluxy-redis-master" | b64enc | quote }}
    REDIS_PORT: {{ "6379" | b64enc }}
    REDIS_PASSWORD: {{ .Values.redis.redis.password | b64enc | quote }}
```

Now we have the helm chart ready. We can deploy our application to kubernetes by a single command:

```bash
helm install fluxy chart/
```

With this we wrap up our service _fluxy_ which can be successfully deployed to kubernetes and supports on-the-fly rate limit configuration for clients. The entire source code is available here - [thegeekywanderer/fluxy]

## References

#### 1. [Building a grpc microservice in Go](https://medium.com/@leodahal4/building-a-grpc-micro-service-in-go-a-comprehensive-guide-82b6812ed253)

#### 2. [Rate limiting in Go](https://mauricio.github.io/2021/12/30/rate-limiting-in-go.html)

#### 3. [Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)

#### 4. [protoc-installation-docs](https://grpc.io/docs/protoc-installation/)

#### 5. [protoc-gen-go](https://github.com/golang/protobuf/releases)

[thegeekywanderer/fluxy]: https://github.com/thegeekywanderer/fluxy
[sdf]: https://google.com
