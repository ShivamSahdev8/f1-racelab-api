from dataclasses import dataclass

@dataclass
class Driver:
    id: str
    name: str
    team: str
    price: float
    points: float

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "team": self.team,
            "price": self.price,
            "points": self.points,
        }
    
@dataclass
class Team:
    user_id: str
    driver_ids: list[str]
    spent: float
    total_points: float
    updated_at: str 

    def to_dict(self) -> dict:
        return {
            "userId": self.user_id,
            "driverIds": self.driver_ids,
            "spent": self.spent,
            "totalPoints": self.total_points,
            "updatedAt": self.updated_at,
        }
    
@dataclass 
class LeaderboardEntry:
    rank: int
    user_id: str
    user_name: str
    favourite_team: str
    total_points: float
    

    def to_dict(self) -> dict:
        return {
            "rank": self.rank,
            "userId": self.user_id,
            "userName": self.user_name,
            "favouriteTeam": self.favourite_team,
            "totalPoints": self.total_points,
        }    
    

@dataclass
class ScoreBreakdown:
    driver_id: str            # "VER"
    position_points: int      # 25 for P1, etc.
    places_gained_points: int # +2 per place gained off the grid
    fastest_lap_points: int   # 10 or 0
    pole_points: int          # 5 or 0
    dnf_penalty: int          # -15 or 0
    total: int                # sum of the above

    def to_dict(self) -> dict:
        return {
            "driverId": self.driver_id,
            "positionPoints": self.position_points,
            "placesGainedPoints": self.places_gained_points,
            "fastestLapPoints": self.fastest_lap_points,
            "polePoints": self.pole_points,
            "dnfPenalty": self.dnf_penalty,
            "total": self.total,
        }    
    

@dataclass
class RaceResult:
    driver_id: str       # "VER"
    grid: int            # where they STARTED (e.g. 3)
    finish: int          # where they FINISHED (e.g. 1)
    fastest_lap: bool    # did they set the fastest lap?
    pole: bool           # did they start P1 (pole position)?
    dnf: bool            # Did Not Finish (crash/mechanical)?    