const {
  autoDetectRenderer,
    Container,
    Graphics,
    Point
} = PIXI;

const tileSize = 7;
const gridWidth = 150;
const gridHeight = 80;
const fillPercent = 50;
const smoothPasses = 14;
const wallThresholdSize = 30;
const roomThresholdSize = 100;
const passageRadius = 1;
// setting this will make the level generate the same way each time
let seed = null;

class Game {
    constructor() {
        const renderer = autoDetectRenderer(0, 0, { antialias: true });
        renderer.backgroundColor = 0xAAAAAA;
        renderer.autoResize = true;
        renderer.resize(window.innerWidth + 44, window.innerHeight);
        document.body.appendChild(renderer.view);

        const stage = new Container;

        const grid = new Grid;

        grid.iterateTiles((x, y) => {
            const enabled = grid.tiles[x][y];
            const rectangle = new Graphics;
            rectangle.beginFill(enabled ? 0x000000 : 0xFFFFFF);
            const pos = {
                x: x != 0 ? x * tileSize : x,
                y: y != 0 ? y * tileSize : y
            };
            rectangle.drawRect(pos.x, pos.y, tileSize, tileSize);
            rectangle.endFill();
            stage.addChild(rectangle);
            grid.passages.forEach(passage => {
                stage.addChild(passage);
            });
        });

        const loop = () => {
            requestAnimationFrame(loop);
            renderer.render(stage);
        };

        loop();
    }
}

class Grid {
    constructor() {
        this.passages = [];
        this.tiles = Array(gridWidth).fill().map(i => []);

        this.randomFill();

        for (let i = 0; i < smoothPasses; i++) {
            this.smooth();
        }

        this.processMap();
    }

    randomFill() {
        const randSeed = seed || (new Date).getTime().toString();
        console.log(`seed: ${randSeed}`);
        const pseudoRandom = new Math.seedrandom(randSeed);

        this.iterateTiles((x, y) => {
            if (x == 0 || x == gridWidth - 1 || y == 0 || y == gridHeight - 1) {
                this.tiles[x][y] = 1;
            } else {
                this.tiles[x][y] = ((pseudoRandom() * 100) < fillPercent) ? 1 : 0;
            }
        });
    }

    getSurroundingWallCount(gridX, gridY) {
        let wallCount = 0;
        for (let neighbourX = gridX - 1; neighbourX <= gridX + 1; neighbourX++) {
            for (let neighbourY = gridY - 1; neighbourY <= gridY + 1; neighbourY++) {
                if (this.isInMapRange(neighbourX, neighbourY)) {
                    if (neighbourX != gridX || neighbourY != gridY) {
                        wallCount += this.tiles[neighbourX][neighbourY];
                    }
                } else {
                    wallCount++;
                }
            }
        }
        return wallCount;
    }

    smooth() {
        this.iterateTiles((x, y) => {
            let neighbourWallTiles = this.getSurroundingWallCount(x, y);
            if (neighbourWallTiles > 4) {
                this.tiles[x][y] = 1;
            } else if (neighbourWallTiles < 4) {
                this.tiles[x][y] = 0;
            }
        });
    }

    iterateTiles(callback) {
        for (let x = 0; x < gridWidth; x++) {
            for (let y = 0; y < gridHeight; y++) {
                callback(x, y);
            }
        }
    }

    processMap() {
        let wallRegions = this.getRegions(1);

        wallRegions.forEach(wallRegion => {
            if (wallRegion.length < wallThresholdSize) {
                wallRegion.forEach(tile => {
                    this.tiles[tile.tileX][tile.tileY] = 0;
                });
            }
        });

        let roomRegions = this.getRegions(0);
        let survivingRooms = [];

        roomRegions.forEach(roomRegion => {
            if (roomRegion.length < roomThresholdSize) {
                roomRegion.forEach(tile => {
                    this.tiles[tile.tileX][tile.tileY] = 1;
                });
            } else {
                survivingRooms.push(new Room(roomRegion, this.tiles));
            }
        });

        survivingRooms.sort((a, b) => b.roomSize - a.roomSize);
        survivingRooms[0].isMainRoom = true;
        survivingRooms[0].isAccessibleFromMainRoom = true;

        this.connectClosestRooms(survivingRooms);
    }

    connectClosestRooms(allRooms, forceAccessibleFromMainRoom) {
        let roomListA = [];
        let roomListB = [];
        
        if (forceAccessibleFromMainRoom) {
            allRooms.forEach(room => {
                if (room.isAccessibleFromMainRoom) {
                    roomListB.push(room);
                } else {
                    roomListA.push(room);
                }
            });
        } else {
            roomListA = allRooms;
            roomListB = allRooms;
        }
        
        let bestDistance = 0;
        let bestTileA = {};
        let bestTileB = {};
        let bestRoomA = {};
        let bestRoomB = {};
        let possibleConnectionFound = false;

        for (let n = 0; n < roomListA.length; n++) {
            let roomA = roomListA[n];
            if (!forceAccessibleFromMainRoom) {
                possibleConnectionFound = false;
                if (roomA.connectedRooms.length > 0) {
                    continue;
                }
            }

            for (let i = 0; i < roomListB.length; i++) {
                let roomB = roomListB[i];
                if (roomA == roomB || roomA.isConnected(roomB)) {
                    continue;
                }

                for (let tileIndexA = 0; tileIndexA < roomA.edgeTiles.length; tileIndexA++) {
                    for (let tileIndexB = 0; tileIndexB < roomB.edgeTiles.length; tileIndexB++) {
                        let tileA = roomA.edgeTiles[tileIndexA];
                        let tileB = roomB.edgeTiles[tileIndexB];
                        let powX = Math.pow(tileA.tileX - tileB.tileX, 2);
                        let powY = Math.pow(tileA.tileY - tileB.tileY, 2);
                        let distanceBetweenRooms = parseInt(powX + powY);

                        if (distanceBetweenRooms < bestDistance || !possibleConnectionFound) {
                            bestDistance = distanceBetweenRooms;
                            possibleConnectionFound = true;
                            bestTileA = tileA;
                            bestTileB = tileB;
                            bestRoomA = roomA;
                            bestRoomB = roomB;
                        }
                    }
                }
            }

            if (possibleConnectionFound && !forceAccessibleFromMainRoom) {
                this.createPassage(bestRoomA, bestRoomB, bestTileA, bestTileB);
            }
        }
        
        if (possibleConnectionFound && forceAccessibleFromMainRoom) {
            this.createPassage(bestRoomA, bestRoomB, bestTileA, bestTileB);
            this.connectClosestRooms(allRooms, true);
        }
        
        if (!forceAccessibleFromMainRoom) {
            this.connectClosestRooms(allRooms, true);
        }
    }

    createPassage(roomA, roomB, tileA, tileB) {
        Room.connectRooms(roomA, roomB);
        
        this.getLine(tileA, tileB).forEach(tile => {
            this.drawCircle(tile, passageRadius);
        });
    }
    
    drawCircle(tile, radius) {
        for (let x = -radius; x <= radius; x++) {
            for (let y = -radius; y <= radius; y++) {
                if (x*x + y*y <= radius*radius) {
                    let drawX = tile.tileX + x;
                    let drawY = tile.tileY + y;
                    if (this.isInMapRange(drawX, drawY)) {
                        this.tiles[drawX][drawY] = 0;
                    }
                }
            }
        }
    }

    getRegions(tileType) {
        let regions = [];
        let mapFlags = Array(gridWidth).fill().map(i => []);

        this.iterateTiles((x, y) => {
            if (!mapFlags[x][y] && this.tiles[x][y] == tileType) {
                let newRegion = this.getRegionTiles(x, y);
                regions.push(newRegion);

                newRegion.forEach(tile => {
                    mapFlags[tile.tileX][tile.tileY] = 1;
                });
            }
        });

        return regions;
    }

    getRegionTiles(startX, startY) {
        let tempTiles = [];
        let mapFlags = Array(gridWidth).fill().map(i => []);
        let tileType = this.tiles[startX][startY];

        let queue = [];
        queue.push({ tileX: startX, tileY: startY });
        mapFlags[startX][startY] = 1;

        while (queue.length) {
            let tile = queue[queue.length - 1];
            queue.splice(queue.length - 1, 1);
            tempTiles.push(tile);

            for (let x = tile.tileX - 1; x <= tile.tileX + 1; x++) {
                for (let y = tile.tileY - 1; y <= tile.tileY + 1; y++) {
                    if (this.isInMapRange(x, y) && (y == tile.tileY || x == tile.tileX)) {
                        if (!mapFlags[x][y] && this.tiles[x][y] == tileType) {
                            mapFlags[x][y] = 1;
                            queue.push({ tileX: x, tileY: y });
                        }
                    }
                }
            }
        }

        return tempTiles;
    }

    isInMapRange(x, y) {
        return x >= 0 && x < gridWidth && y >= 0 && y < gridHeight;
    }
    
    getLine(from, to) {
        let line = [];
        
        let {tileX: x, tileY: y} = from;

        let dx = to.tileX - from.tileX;
        let dy = to.tileY - from.tileY;
        
        let inverted = false;
        let step = Math.sign(dx);
        let gradientStep = Math.sign(dy);
        
        let longest = Math.abs(dx);
        let shortest = Math.abs(dy);
        
        if (longest < shortest) {
            inverted = true;
            longest = Math.abs(dy);
            shortest = Math.abs(dx);
            
            step = Math.sign(dy);
            gradientStep = Math.sign(dx);
        }
        
        let gradientAccumulation = longest / 2;
        for (let i = 0; i < longest; i++) {
            line.push({tileX: x, tileY: y});
            
            if (inverted) {
                y += step;
            } else {
                x += step;
            }
            
            gradientAccumulation += shortest;
            if (gradientAccumulation >= longest) {
                if (inverted) {
                    x += gradientStep;
                } else {
                    y += gradientStep;
                }
                gradientAccumulation -= longest;
            }
        }
        
        return line;
    }
}

class Room {
    constructor(roomTiles, map) {
        this.tiles = roomTiles;
        this.roomSize = roomTiles.length;
        this.connectedRooms = [];
        this.edgeTiles = [];

        roomTiles.forEach(tile => {
            for (let x = tile.tileX - 1; x <= tile.tileX + 1; x++) {
                for (let y = tile.tileY - 1; y <= tile.tileY + 1; y++) {
                    if (x == tile.tileX || y == tile.tileY) {
                        if (map[x][y] == 1) {
                            this.edgeTiles.push(tile);
                        }
                    }
                }
            }
        });
    }
    
    setAccessibleFromMainRoom() {
        if (!this.isAccessibleFromMainRoom) {
            this.isAccessibleFromMainRoom = true;
            this.connectedRooms.forEach(room => {
                room.setAccessibleFromMainRoom();
            });
        }
    }

    static connectRooms(roomA, roomB) {
        if (roomA.isAccessibleFromMainRoom) {
            roomB.setAccessibleFromMainRoom();
        } else if (roomB.isAccessibleFromMainRoom) {
            roomA.setAccessibleFromMainRoom();
        }
        roomA.connectedRooms.push(roomB);
        roomB.connectedRooms.push(roomA);
    }

    isConnected(otherRoom) {
        return this.connectedRooms.includes(otherRoom);
    }
}

new Game;
